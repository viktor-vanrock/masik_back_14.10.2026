import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@/common/enums/role.enum';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie, E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Leaderboard boards HTTP and migration contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let otherCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    cookie = await createAuthCookie(app, Role.User);
    otherCookie = await createAuthCookie(app, Role.Admin);
  });

  afterAll(async () => {
    await prisma.leaderboardBoard.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('seeds the three public boards with unique system keys and architecture rules', async () => {
    const response = await request(app.getHttpServer()).get('/api/leaderboard-boards/public').expect(200);
    expect(response.body).toHaveLength(3);
    expect(response.body.map((board: { systemKey: string }) => board.systemKey))
      .toEqual(expect.arrayContaining(['general', 'alternative-architectures', 'agent-systems']));
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ systemKey: 'alternative-architectures', userId: null, isPublic: true,
        architectures: ['ar-transformer', 'text-diffusion', 'latent-reasoner', 'colloquium', 'omnimodal'] }),
    ]));
    await expect(prisma.leaderboardBoard.create({ data: { name: 'Duplicate', systemKey: 'general' } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('persists personal boards with NULL system keys, updates rules and enforces ownership', async () => {
    for (const name of [' First board ', 'Second board']) {
      const created = await request(app.getHttpServer()).post('/api/leaderboard-boards')
        .set('Origin', E2E_ORIGIN).set('Cookie', cookie)
        .send({ name, description: 'Description', architectures: ['text-diffusion'] }).expect(201);
      ids.push(created.body.id as string);
      expect(created.body).toMatchObject({ name: name.trim(), systemKey: null, isPublic: false });
    }
    const ownList = await request(app.getHttpServer()).get('/api/leaderboard-boards/mine')
      .set('Cookie', cookie).expect(200);
    expect(ownList.body).toEqual(expect.arrayContaining(ids.map((id) => expect.objectContaining({ id }))));
    const otherList = await request(app.getHttpServer()).get('/api/leaderboard-boards/mine')
      .set('Cookie', otherCookie).expect(200);
    for (const id of ids) expect(otherList.body.map((board: { id: string }) => board.id)).not.toContain(id);

    await request(app.getHttpServer()).patch(`/api/leaderboard-boards/${ids[0]}`)
      .set('Origin', E2E_ORIGIN).set('Cookie', otherCookie).send({ name: 'Forbidden' }).expect(404);
    await request(app.getHttpServer()).patch(`/api/leaderboard-boards/${ids[0]}`)
      .set('Origin', E2E_ORIGIN).set('Cookie', cookie)
      .send({ description: null, architectures: ['omnimodal'] }).expect(200);
    await expect(prisma.leaderboardBoard.findUniqueOrThrow({ where: { id: ids[0] } }))
      .resolves.toMatchObject({ name: 'First board', description: null, architectures: ['omnimodal'] });
    await request(app.getHttpServer()).delete(`/api/leaderboard-boards/${ids[0]}`)
      .set('Origin', E2E_ORIGIN).set('Cookie', cookie).expect(204);
    await expect(prisma.leaderboardBoard.findUnique({ where: { id: ids[0] } })).resolves.toBeNull();
  });

  it('rejects invalid names, architectures, references and PATCH null with HTTP 400', async () => {
    const created = await request(app.getHttpServer()).post('/api/leaderboard-boards')
      .set('Origin', E2E_ORIGIN).set('Cookie', cookie).send({ name: 'Validation board' }).expect(201);
    ids.push(created.body.id as string);
    for (const payload of [
      { name: '   ' }, { name: 'Board', architectures: ['unknown'] },
      { name: 'Board', modelIds: ['missing-model'] },
      { name: 'Board', benchmarkIds: ['missing-test'] },
      { name: 'Board', modelIds: ['x'.repeat(161)] },
    ]) {
      await request(app.getHttpServer()).post('/api/leaderboard-boards')
        .set('Origin', E2E_ORIGIN).set('Cookie', cookie).send(payload).expect(400);
    }
    await request(app.getHttpServer()).patch(`/api/leaderboard-boards/${created.body.id}`)
      .set('Origin', E2E_ORIGIN).set('Cookie', cookie).send({ name: null }).expect(400);
  });

  it('accepts only active published Tests in benchmarkIds', async () => {
    const testIds = ['board-published-test', 'board-draft-test', 'board-archived-test', 'board-deleted-test'];
    const now = new Date('2026-10-23T12:00:00.000Z');
    try {
      await prisma.catalogTestProjection.createMany({ data: testIds.map((testId) => ({
        testId, aggregateVersion: 1, sourceUpdatedAt: now,
        ...('board-deleted-test' === testId ? { deletedAt: now } : {}),
      })) });
      await prisma.catalogEntry.createMany({ data: testIds.map((testId) => ({
        testId,
        status: 'board-draft-test' === testId ? BenchmarkValidationStatus.validation : BenchmarkValidationStatus.published,
        ...('board-archived-test' === testId ? { archivedAt: now } : {}),
      })) });

      const rejected = await request(app.getHttpServer()).post('/api/leaderboard-boards')
        .set('Origin', E2E_ORIGIN).set('Cookie', cookie)
        .send({ name: 'Invalid board', benchmarkIds: testIds }).expect(400);
      expect(rejected.body.message).toContain('board-draft-test, board-archived-test, board-deleted-test');

      const accepted = await request(app.getHttpServer()).post('/api/leaderboard-boards')
        .set('Origin', E2E_ORIGIN).set('Cookie', cookie)
        .send({ name: 'Published board', benchmarkIds: ['board-published-test'] }).expect(201);
      ids.push(accepted.body.id as string);
    } finally {
      await prisma.leaderboardBoard.deleteMany({ where: { benchmarkIds: { hasSome: testIds } } });
      await prisma.catalogEntry.deleteMany({ where: { testId: { in: testIds } } });
      await prisma.catalogTestProjection.deleteMany({ where: { testId: { in: testIds } } });
    }
  });
});

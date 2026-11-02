import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { ContactRequestsService } from '@/contact-requests/contact-requests.service';
import { Prisma, Role } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

// A real Factory-produced context is committed as a static contract fixture.
const prepared = JSON.parse(readFileSync(`${__dirname}/fixtures/demo-prepared-context.json`, 'utf8')) as Prisma.InputJsonObject;

describe('DEMO visitor contact flow (PostgreSQL + real HTTP)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const owner = randomUUID();
  const foreign = randomUUID();
  let id: string;
  let cookie: string;
  let foreignCookie: string;
  const input = () => ({ conversationId: id, fullName: 'Иван Посетитель', email: 'visitor@пример.рф', consent: true });
  const post = (body = input(), session = cookie, key = randomUUID()) => request(app.getHttpServer())
    .post('/api/demo/contacts').set('Origin', E2E_ORIGIN).set('Cookie', session).set('Idempotency-Key', key).send(body);

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    for (const userId of [owner, foreign]) await prisma.user.create({ data: {
      id: userId, username: `demo-${userId}`, email: `${userId}@example.test`, password: 'test-unused', role: Role.DEMO,
    } });
    // Even stale pre-assignment cookies must use current DB role at the boundary.
    const sign = async (sub: string) => `${AUTH_COOKIE_NAME}=${await app.get(JwtService).signAsync({ sub, username: sub, role: 'USER' })}`;
    cookie = await sign(owner);
    foreignCookie = await sign(foreign);
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id: owner }, data: { role: Role.DEMO } });
    id = (await prisma.conversation.create({ data: { userId: owner, intent: 'create_new', agentContext: prepared } })).id;
  });
  afterAll(async () => {
    const chats = await prisma.conversation.findMany({ where: { userId: { in: [owner, foreign] } }, select: { id: true } });
    await prisma.contactRequest.deleteMany({ where: { chatId: { in: chats.map(chat => chat.id) } } });
    await prisma.conversation.deleteMany({ where: { userId: { in: [owner, foreign] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, foreign] } } });
    await app.close();
  });

  it('saves independent visitors, freezes material, and exposes no contacts in detail/history', async () => {
    const first = await post().expect(201);
    const second = await post().expect(201);
    expect(first.body.publicNumber).toMatch(/^AIJ-/);
    expect(second.body.publicNumber).not.toBe(first.body.publicNumber);
    expect(Object.keys(first.body)).toEqual(['publicNumber']);
    const saved = await prisma.contactRequest.findMany({ where: { chatId: id } });
    expect(saved).toHaveLength(2);
    expect(saved[0].materialSnapshot).toMatchObject({ kind: 'prepared_brief', revision: (prepared.prepared_brief as Prisma.InputJsonObject).revision });
    const detail = await request(app.getHttpServer()).get(`/api/conversations/${id}`).set('Cookie', cookie).expect(200);
    expect(detail.body.demoRequest.status).toBe('ready');
    for (const forbidden of ['visitor@пример.рф', 'Иван Посетитель', 'materialSnapshot', 'prepared_brief', 'contactRequests']) {
      expect(JSON.stringify(detail.body)).not.toContain(forbidden);
    }
    await request(app.getHttpServer()).patch(`/api/conversations/${id}`).set('Origin', E2E_ORIGIN).set('Cookie', cookie)
      .send({ title: 'Changed' }).expect(409);
    await request(app.getHttpServer()).patch(`/api/conversations/${id}`).set('Origin', E2E_ORIGIN).set('Cookie', cookie)
      .send({ isPinned: true }).expect(200);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).pinnedDate).not.toBeNull();
    expect((await prisma.contactRequest.findMany({ where: { chatId: id } })).map(item => item.materialSnapshot))
      .toEqual(saved.map(item => item.materialSnapshot));
  });

  it('rejects foreign/ordinary/not-ready callers and requires all three contact fields', async () => {
    await post(input(), foreignCookie).expect(404);
    await post({ ...input(), consent: false }).expect(400);
    await post({ ...input(), fullName: 'A' }).expect(400);
    await post({ ...input(), email: 'invalid' }).expect(400);
    await prisma.user.update({ where: { id: owner }, data: { role: Role.USER } });
    await post().expect(403);
    await prisma.user.update({ where: { id: owner }, data: { role: Role.DEMO } });
    await prisma.conversation.update({ where: { id }, data: { agentContext: {} } });
    await post().expect(409);
    expect(await prisma.contactRequest.count({ where: { chatId: id } })).toBe(0);
  });

  it('accepts a completed chat with no prepared draft while preserving frozen original data', async () => {
    await prisma.conversation.update({ where: { id }, data: { status: 'completed', agentContext: {} } });
    await post().expect(201);
    const saved = await prisma.contactRequest.findFirstOrThrow({ where: { chatId: id } });
    expect(saved.materialSnapshot).toMatchObject({ kind: 'completed_chat', conversationId: id });
    await request(app.getHttpServer()).patch(`/api/conversations/${id}`).set('Origin', E2E_ORIGIN).set('Cookie', cookie)
      .send({ isArchived: true }).expect(409);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).status).toBe('completed');
  });

  it('deduplicates concurrent deliveries and survives a new service instance while allowing new visitors', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 4 }, () => post(input(), cookie, key)));
    expect(responses.map(response => response.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map(response => response.body.publicNumber)).size).toBe(1);
    expect(await prisma.contactRequest.count({ where: { chatId: id } })).toBe(1);
    const replay = await new ContactRequestsService(prisma).create({
      chatId: id, fullName: input().fullName, email: input().email, consent: true,
    }, owner, key.toUpperCase());
    expect(replay.publicNumber).toBe(responses[0].body.publicNumber);
    await post(input(), cookie, randomUUID()).expect(201);
    expect(await prisma.contactRequest.count({ where: { chatId: id } })).toBe(2);
    await post({ ...input(), email: 'other@example.test' }, cookie, key).expect(409);
    expect(await prisma.contactRequest.count({ where: { chatId: id } })).toBe(2);
    await prisma.user.update({ where: { id: owner }, data: { role: Role.USER } });
    await post(input(), cookie, key).expect(403);
  });

  it('does not reuse an account key for a different chat, including simultaneous submissions', async () => {
    const other = await prisma.conversation.create({ data: { userId: owner, status: 'completed' } });
    const key = randomUUID();
    const outcomes = await Promise.all([
      post(input(), cookie, key),
      post({ ...input(), conversationId: other.id }, cookie, key),
    ]);
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual([201, 409]);
    expect(await prisma.contactRequest.count({ where: { requestOwnerId: owner, idempotencyKey: key } })).toBe(1);
    expect(Object.keys(outcomes.find(outcome => 409 === outcome.status)!.body)).not.toContain('publicNumber');
  });
});

import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { BenchmarkJobsService } from '@/generation/benchmark-jobs.service';
import { ProductionJobsService } from '@/generation/production-jobs.service';
import { PrismaService } from '@/prisma/prisma.service';
import { E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Owned conversation soft deletion (PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const owner = randomUUID();
  let cookie: string;
  let foreignCookie: string;
  const ids: string[] = [];
  const remove = (id: string, session = cookie) => request(app.getHttpServer()).delete(`/api/conversations/${id}`)
    .set('Cookie', session).set('Origin', E2E_ORIGIN);
  const get = (path: string) => request(app.getHttpServer()).get(`/api/${path}`).set('Cookie', cookie);
  const create = async (extra: object = {}) => {
    const chat = await prisma.conversation.create({ data: { userId: owner, ...extra } }); ids.push(chat.id); return chat;
  };
  beforeAll(async () => {
    app = await createE2eApplication(); prisma = app.get(PrismaService);
    await prisma.user.create({ data: { id: owner, username: `delete-${owner}`, email: `${owner}@example.test`, password: 'unused-test', role: 'DEMO' } });
    const sign = async (sub: string) => `${AUTH_COOKIE_NAME}=${await app.get(JwtService).signAsync({ sub, username: sub, role: 'DEMO' })}`;
    cookie = await sign(owner); foreignCookie = await sign(randomUUID());
  });
  afterAll(async () => {
    await prisma.contactRequest.deleteMany({ where: { chatId: { in: ids } } });
    await prisma.$executeRaw`DELETE FROM benchmark_producer_jobs WHERE interview_session_id = ANY(${ids}::text[])`;
    await prisma.$executeRaw`DELETE FROM benchmark_creator_jobs WHERE interview_session_id = ANY(${ids}::text[])`;
    await prisma.conversation.deleteMany({ where: { userId: owner } });
    await prisma.user.delete({ where: { id: owner } }); await app.close();
  });

  it('hides history, pinned and archived tombstones while retaining contacts, messages and context', async () => {
    const context = { requirements: { goal: 'Сохранить материал' }, brief: { source: 'retained' } };
    const chats = await Promise.all([create({ pinnedDate: new Date() }), create({ isArchived: true }), create()]);
    const id = chats[0].id;
    await prisma.conversation.update({ where: { id }, data: { agentContext: context, status: 'completed' } });
    const message = await prisma.message.create({ data: { conversationId: id, role: 'agent', kind: 'text', content: 'Сохранённый ответ' } });
    await prisma.contactRequest.create({ data: { chatId: id, publicNumber: `QA-${randomUUID()}`, fullName: 'Посетитель QA', email: 'qa@example.test', consent: true, consentVersion: 'test' } });
    for (const chat of chats) { await remove(chat.id).expect(204); await get(`conversations/${chat.id}`).expect(404); }
    await remove(id).expect(204);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ isDeleted: true, deletedAt: expect.any(Date), agentContext: context });
    expect(await prisma.message.findUnique({ where: { id: message.id } })).not.toBeNull();
    expect(await prisma.contactRequest.count({ where: { chatId: id } })).toBe(1);
    for (const path of ['conversations', 'conversations/sidebar', 'conversations/sidebar/archive']) {
      const response = await get(path).expect(200);
      for (const chat of chats) expect(JSON.stringify(response.body)).not.toContain(chat.id);
    }
    await request(app.getHttpServer()).patch(`/api/conversations/${id}`).set('Cookie', cookie).set('Origin', E2E_ORIGIN)
      .send({ isPinned: false }).expect(404);
    await request(app.getHttpServer()).post('/api/demo/contacts').set('Cookie', cookie).set('Origin', E2E_ORIGIN)
      .set('Idempotency-Key', randomUUID()).send({ conversationId: id, fullName: 'Посетитель QA', email: 'qa@example.test', consent: true }).expect(404);
  });

  it('checks ownership and authentication before deletion', async () => {
    const chat = await create();
    await remove(chat.id, foreignCookie).expect(404);
    await request(app.getHttpServer()).delete(`/api/conversations/${chat.id}`).set('Origin', E2E_ORIGIN).expect(401);
    await remove(randomUUID()).expect(404);
    await remove('not-a-uuid').expect(400);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } })).isDeleted).toBe(false);
  });

  it('revokes active Inventor and Producer leases, keeps job rows, and rejects late callbacks', async () => {
    await prisma.user.update({ where: { id: owner }, data: { role: 'USER' } });
    const chat = await create({ status: 'generating' });
    const creator = randomUUID(), producer = randomUUID(), lease = randomUUID();
    const hash = 'a'.repeat(64);
    await prisma.$executeRaw`INSERT INTO benchmark_creator_jobs(id, interview_session_id, schema_version, brief, request_hash, status, lease_token, lease_expires_at)
      VALUES(CAST(${creator} AS uuid),${chat.id},'1.0','{}'::jsonb,${hash},'running',CAST(${lease} AS uuid),now()+interval '2 minutes')`;
    await prisma.$executeRaw`INSERT INTO benchmark_producer_jobs(id,interview_session_id,creator_job_id,brief,seed_examples,requested_count,status,lease_token,lease_expires_at)
      VALUES(CAST(${producer} AS uuid),${chat.id},CAST(${creator} AS uuid),'{}'::jsonb,'[]'::jsonb,2,'running',CAST(${lease} AS uuid),now()+interval '2 minutes')`;
    await remove(chat.id).expect(204);
    await get(`conversations/${chat.id}/generation`).expect(404);
    await get(`conversations/${chat.id}/production`).expect(404);
    const inventor = app.get(BenchmarkJobsService), factory = app.get(ProductionJobsService);
    await expect(inventor.heartbeat(creator, { lease_token: lease, progress_version: 1, progress: {} }))
      .rejects.toMatchObject({ status: 409 });
    await expect(factory.heartbeat(producer, { lease_token: lease, progress_version: 1, progress: {} }))
      .rejects.toMatchObject({ status: 409 });
    const stored = await prisma.$queryRaw<Array<{ status: string; lease_token: string | null }>>`
      SELECT status,lease_token FROM benchmark_creator_jobs WHERE id=CAST(${creator} AS uuid)`;
    expect(stored).toHaveLength(1); expect(stored[0].lease_token).toBeNull();
    const producers = await prisma.$queryRaw<Array<{ lease_token: string | null }>>`
      SELECT lease_token FROM benchmark_producer_jobs WHERE id=CAST(${producer} AS uuid)`;
    expect(producers).toHaveLength(1); expect(producers[0].lease_token).toBeNull();
  });
});

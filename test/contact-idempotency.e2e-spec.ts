import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { PrismaService } from '@/prisma/prisma.service';
import { E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Contact idempotency across HTTP replicas (PostgreSQL)', () => {
  let apps: NestExpressApplication[];
  let prisma: PrismaService;
  const owner = randomUUID();
  const otherOwner = randomUUID();
  let chats: string[];
  let cookies: string[];
  const payload = (conversationId = chats[0]) => ({ conversationId, fullName: '  Иван Посетитель  ', email: '  person@пример.рф  ', consent: true });
  const post = (index: number, key: string | null, body: object = payload(), ownerIndex = 0, legacy = false) => {
    const call = request(apps[index].getHttpServer()).post(legacy ? '/api/contact-requests' : '/api/demo/contacts')
      .set('Origin', E2E_ORIGIN).set('Cookie', cookies[ownerIndex]);
    if (key !== null) call.set('Idempotency-Key', key);
    return call.send(body);
  };

  beforeAll(async () => {
    apps = [await createE2eApplication(), await createE2eApplication()];
    prisma = apps[0].get(PrismaService);
    cookies = [];
    chats = [];
    for (const id of [owner, otherOwner]) {
      await prisma.user.create({ data: { id, username: `idem-${id}`, email: `${id}@example.test`, password: 'test-unused', role: 'DEMO' } });
      cookies.push(`${AUTH_COOKIE_NAME}=${await apps[0].get(JwtService).signAsync({ sub: id, username: id, role: 'DEMO' })}`);
    }
    for (const userId of [owner, owner, otherOwner]) chats.push((await prisma.conversation.create({ data: { userId, status: 'completed' } })).id);
  });
  afterAll(async () => {
    await prisma.contactRequest.deleteMany({ where: { chatId: { in: chats } } });
    await prisma.conversation.deleteMany({ where: { id: { in: chats } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, otherOwner] } } });
    for (const app of apps) await app.close();
  });

  it('saves twelve concurrent deliveries once, including the legacy alias, and replays after a replica restart', async () => {
    const key = randomUUID();
    const body = payload();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => 0 === i % 3
      ? post(i % 2, key, { chatId: body.conversationId, fullName: body.fullName, email: body.email, consent: true }, 0, true)
      : post(i % 2, key, body)));
    expect(results.every(result => 201 === result.status)).toBe(true);
    const numbers = new Set(results.map(result => result.body.publicNumber));
    expect(numbers.size).toBe(1);
    const publicNumber = results[0].body.publicNumber;
    expect(await prisma.contactRequest.count({ where: { publicNumber } })).toBe(1);
    await apps[1].close();
    apps[1] = await createE2eApplication();
    const replay = await post(1, key, { ...body, fullName: body.fullName.trim(), email: body.email.trim() }).expect(201);
    expect(replay.body).toEqual({ publicNumber });
    expect(await prisma.contactRequest.count({ where: { publicNumber } })).toBe(1);
  });

  it('returns 409 for a scoped key reused with changed contacts or another chat without exposing the old result', async () => {
    const key = randomUUID();
    const first = await post(0, key).expect(201);
    for (const body of [{ ...payload(), fullName: 'Другой посетитель' }, payload(chats[1])]) {
      const conflict = await post(1, key, body).expect(409);
      expect(JSON.stringify(conflict.body)).not.toContain(first.body.publicNumber);
      expect(JSON.stringify(conflict.body)).not.toContain('person@пример.рф');
    }
    expect(await prisma.contactRequest.count({ where: { publicNumber: first.body.publicNumber } })).toBe(1);
  });

  it('preserves independent visitors and scopes keys to their authenticated account', async () => {
    const shared = randomUUID();
    const first = await post(0, shared).expect(201);
    const second = await post(1, randomUUID()).expect(201);
    const third = await post(1, shared, payload(chats[2]), 1).expect(201);
    expect(new Set([first.body.publicNumber, second.body.publicNumber, third.body.publicNumber]).size).toBe(3);
  });

  it.each([null, '', 'same-key', 'x'.repeat(200)])('rejects a missing or malformed idempotency key %j', async (key) => {
    await post(0, key).expect(400);
  });
});

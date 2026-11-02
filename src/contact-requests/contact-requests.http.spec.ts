import { randomUUID } from 'node:crypto';
import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '@/auth/jwt/jwt-auth.guard';
import { JwtStrategy } from '@/auth/jwt/jwt.strategy';
import { OriginCsrfGuard } from '@/common/guards/origin-csrf.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ContactRequestsRateLimitGuard } from './contact-requests-rate-limit.guard';
import { ContactRequestsController } from './contact-requests.controller';
import { ContactRequestsService } from './contact-requests.service';
import { DemoContactsController } from './demo-contacts.controller';

describe('POST /api/contact-requests', () => {
  let app: NestExpressApplication;
  const service = { create: jest.fn(), list: jest.fn() };
  const config: Record<string, unknown> = {
    jwtAccessSecret: 'contact-request-test-secret', nodeEnv: 'dev', trustedOrigins: [],
  };
  const jwt = new JwtService({ secret: String(config.jwtAccessSecret) });
  const key = randomUUID();
  const cookie = `access_token=${jwt.sign({ sub: 'owner-id', username: 'owner', role: 'user' })}`;
  const body = {
    chatId: '11111111-1111-4111-8111-111111111111',
    fullName: '  Иван Иванов  ', email: '  яиты@собака.рф  ', consent: true,
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ContactRequestsController, DemoContactsController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: { get: (key: string) => config[key], getOrThrow: (key: string) => config[key] } },
        { provide: ContactRequestsService, useValue: service },
        ContactRequestsRateLimitGuard,
        { provide: APP_GUARD, useClass: OriginCsrfGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { jest.clearAllMocks(); service.create.mockResolvedValue({ publicNumber: 'AIJ-2026-ABC123' }); });

  it('permits administrators and superusers to list contacts and disables response caching', async () => {
    await request(app.getHttpServer()).get('/api/contact-requests').expect(401);
    for (const role of ['USER', 'DEMO']) {
      const token = jwt.sign({ sub: 'owner-id', username: 'owner', role });
      await request(app.getHttpServer()).get('/api/contact-requests').set('Cookie', `access_token=${token}`).expect(403);
    }
    expect(service.list).not.toHaveBeenCalled();
    service.list.mockResolvedValue({ data: [], nextCursor: null });
    for (const role of ['ADMIN', 'SUPERUSER']) {
      const token = jwt.sign({ sub: 'admin-id', username: 'admin', role });
      const response = await request(app.getHttpServer()).get('/api/contact-requests')
        .set('Cookie', `access_token=${token}`).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(service.list).toHaveBeenCalledWith('admin-id', undefined);
    }
    const token = jwt.sign({ sub: 'super-id', username: 'super', role: 'SUPERUSER' });
    await request(app.getHttpServer()).get('/api/contact-requests?cursor=invalid')
      .set('Cookie', `access_token=${token}`).expect(400);
  });

  it('requires login and a permitted browser origin', async () => {
    await request(app.getHttpServer()).post('/api/contact-requests').set('Idempotency-Key', key)
      .set('Origin', 'http://localhost:5173').send(body).expect(401);
    await request(app.getHttpServer()).post('/api/contact-requests').set('Idempotency-Key', key)
      .set('Cookie', cookie).send(body).expect(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('validates, trims, and passes an international email to the owner service', async () => {
    await request(app.getHttpServer()).post('/api/contact-requests').set('Idempotency-Key', key)
      .set('Origin', 'http://localhost:5173').set('Cookie', cookie).send(body)
      .expect(201, { publicNumber: 'AIJ-2026-ABC123' });
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      chatId: body.chatId, fullName: 'Иван Иванов', email: 'яиты@собака.рф', consent: true,
    }), 'owner-id', key);
  });

  it.each([
    { consent: false },
    { fullName: ' A ' },
    { email: 'wrong' },
    { chatId: 'not-a-uuid' },
  ])('rejects an invalid request before saving: %j', async (patch) => {
    await request(app.getHttpServer()).post('/api/contact-requests').set('Idempotency-Key', key)
      .set('Origin', 'http://localhost:5173').set('Cookie', cookie)
      .send({ ...body, ...patch }).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('maps a missing or foreign chat to 404', async () => {
    service.create.mockRejectedValueOnce(new NotFoundException('Chat not found'));
    await request(app.getHttpServer()).post('/api/contact-requests').set('Idempotency-Key', key)
      .set('Origin', 'http://localhost:5173').set('Cookie', cookie)
      .send(body).expect(404);
  });

  it('limits writes per authenticated account', async () => {
    const limitedCookie = `access_token=${jwt.sign({ sub: 'limited-owner', username: 'limited', role: 'user' })}`;
    for (let i = 0; i < 60; i += 1) {
      await request(app.getHttpServer()).post('/api/contact-requests').set('Idempotency-Key', key)
        .set('Origin', 'http://localhost:5173').set('Cookie', limitedCookie)
        .send(body).expect(201);
    }
    const calls = service.create.mock.calls.length;
    const response = await request(app.getHttpServer()).post('/api/contact-requests').set('Idempotency-Key', key)
      .set('Origin', 'http://localhost:5173').set('Cookie', limitedCookie)
      .send(body).expect(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(service.create).toHaveBeenCalledTimes(calls);
  });

  it('passes the canonical DTO and key to the same service as the legacy alias', async () => {
    const { chatId, ...contact } = body;
    await request(app.getHttpServer()).post('/api/demo/contacts').set('Idempotency-Key', key)
      .set('Origin', 'http://localhost:5173').set('Cookie', cookie)
      .send({ ...contact, conversationId: chatId }).expect(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      chatId, fullName: 'Иван Иванов', email: 'яиты@собака.рф', consent: true,
    }), 'owner-id', key);
  });

  it.each(['/api/demo/contacts', '/api/contact-requests'])('requires a UUID v4 key for %s', async (path) => {
    const { chatId, ...contact } = body;
    const data = path.includes('/demo/') ? { ...contact, conversationId: chatId } : body;
    for (const invalid of [undefined, 'shared-key', '00000000-0000-1000-8000-000000000000']) {
      const pending = request(app.getHttpServer()).post(path)
        .set('Origin', 'http://localhost:5173').set('Cookie', cookie);
      if (invalid !== undefined) pending.set('Idempotency-Key', invalid);
      await pending.send(data).expect(400);
    }
    expect(service.create).not.toHaveBeenCalled();
  });
});

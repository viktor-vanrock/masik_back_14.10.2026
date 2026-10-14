import { ValidationPipe } from '@nestjs/common';
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
import { BenchmarkJobsController } from './benchmark-jobs.controller';
import { BenchmarkJobsService } from './benchmark-jobs.service';
import { GenerationController } from './generation.controller';
import { InterviewerServiceTokenGuard } from './interviewer-service-token.guard';

describe('Generation HTTP authorization and worker body parsing', () => {
  let app: NestExpressApplication;
  const id = '14a2b43e-8935-4077-a30e-635f708d904f';
  const service = { claim: jest.fn().mockResolvedValue({ job: null }), accept: jest.fn(),
    heartbeat: jest.fn().mockResolvedValue({ status: 'accepted' }),
    getBySession: jest.fn().mockResolvedValue({ job: null }),
    getForOwner: jest.fn().mockResolvedValue({ status: 'none' }),
    retryForOwner: jest.fn().mockResolvedValue({ status: 'queued' }),
    cancelForOwner: jest.fn().mockResolvedValue({ status: 'cancelled' }) };
  const config: Record<string, unknown> = {
    'agent.apiKey': 'test-factory-service-token', jwtAccessSecret: 'test-cookie-signing-key',
    nodeEnv: 'dev', trustedOrigins: [],
  };
  const jwt = new JwtService({ secret: String(config.jwtAccessSecret) });
  const cookie = `access_token=${jwt.sign({ sub: 'owner', username: 'owner', role: 'user' })}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [BenchmarkJobsController, GenerationController],
      providers: [JwtStrategy, InterviewerServiceTokenGuard,
        { provide: ConfigService, useValue: { get: (key: string) => config[key], getOrThrow: (key: string) => config[key] } },
        { provide: BenchmarkJobsService, useValue: service },
        { provide: APP_GUARD, useClass: OriginCsrfGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useBodyParser('json', { limit: '7mb' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('accepts the factory bearer token without browser CSRF headers and rejects missing/wrong tokens', async () => {
    await request(app.getHttpServer()).post('/api/internal/v1/benchmark-jobs/claim').expect(401);
    await request(app.getHttpServer()).post('/api/internal/v1/benchmark-jobs/claim').set('Authorization', 'Bearer wrong').expect(401);
    await request(app.getHttpServer()).post('/api/internal/v1/benchmark-jobs/claim')
      .set('Authorization', 'Bearer test-factory-service-token').expect(200, { job: null });
    expect(service.claim).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer()).get(`/api/internal/v1/benchmark-jobs/session/${id}`)
      .set('Authorization', 'Bearer test-factory-service-token').expect(200, { job: null });
  });

  it('preserves worker nested payloads beyond the default 100 KiB body parser limit', async () => {
    const body = { lease_token: id, progress_version: 1, progress: {
      phase: 'publishing', result: { examples: [{ input: 'Q'.repeat(120_000), output: 'A' }] },
    } };
    await request(app.getHttpServer()).post(`/api/internal/v1/benchmark-jobs/${id}/heartbeat`)
      .set('Authorization', 'Bearer test-factory-service-token').send(body).expect(200);
    expect(service.heartbeat).toHaveBeenCalledWith(id, body);
  });

  it('protects owner views with the usual login cookie and keeps retry CSRF protected', async () => {
    await request(app.getHttpServer()).get(`/api/conversations/${id}/generation`).expect(401);
    await request(app.getHttpServer()).get(`/api/conversations/${id}/generation`)
      .set('Authorization', 'Bearer test-factory-service-token').expect(401);
    await request(app.getHttpServer()).get(`/api/conversations/${id}/generation`).set('Cookie', cookie).expect(200);
    expect(service.getForOwner).toHaveBeenCalledWith(id, 'owner');
    await request(app.getHttpServer()).post(`/api/conversations/${id}/generation/retry`).set('Cookie', cookie).expect(403);
    await request(app.getHttpServer()).post(`/api/conversations/${id}/generation/retry`)
      .set('Cookie', cookie).set('Origin', 'http://localhost:5173').expect(200);
    expect(service.retryForOwner).toHaveBeenCalledWith(id, 'owner');
  });

  it('requires login, browser CSRF and a valid job ID for cancellation', async () => {
    const route = `/api/conversations/${id}/generation/${id}/cancel`;
    await request(app.getHttpServer()).post(route).set('Origin', 'http://localhost:5173').expect(401);
    await request(app.getHttpServer()).post(route).set('Cookie', cookie).expect(403);
    await request(app.getHttpServer()).post(`/api/conversations/${id}/generation/not-uuid/cancel`)
      .set('Cookie', cookie).set('Origin', 'http://localhost:5173').expect(400);
    await request(app.getHttpServer()).post(route)
      .set('Cookie', cookie).set('Origin', 'http://localhost:5173').expect(200, { status: 'cancelled' });
    expect(service.cancelForOwner).toHaveBeenCalledTimes(1);
    expect(service.cancelForOwner).toHaveBeenCalledWith(id, 'owner', id);
  });
});

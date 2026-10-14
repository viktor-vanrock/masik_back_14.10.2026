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
import { InterviewerServiceTokenGuard } from './interviewer-service-token.guard';
import { ProductionJobsController } from './production-jobs.controller';
import { ProductionJobsService } from './production-jobs.service';
import { ProductionController } from './production.controller';

describe('Production HTTP authorization', () => {
  let app: NestExpressApplication;
  const id = '14a2b43e-8935-4077-a30e-635f708d904f';
  const view = { jobId: null, status: 'none', requestedCount: null,
    generatedCount: 0, examples: [], error: null, selectedIndices: [] };
  const service = { getForOwner: jest.fn().mockResolvedValue(view),
    startForOwner: jest.fn().mockResolvedValue(view),
    claim: jest.fn().mockResolvedValue({ job: null }),
    heartbeat: jest.fn().mockResolvedValue({ status: 'accepted' }),
    complete: jest.fn().mockResolvedValue({ status: 'succeeded' }) };
  const config: Record<string, unknown> = {
    'agent.apiKey': 'factory-token', jwtAccessSecret: 'test-cookie-signing-key',
    nodeEnv: 'dev', trustedOrigins: [],
  };
  const jwt = new JwtService({ secret: String(config.jwtAccessSecret) });
  const cookie = `access_token=${jwt.sign({ sub: 'owner', username: 'owner', role: 'user' })}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProductionController, ProductionJobsController],
      providers: [JwtStrategy, InterviewerServiceTokenGuard,
        { provide: ConfigService, useValue: { get: (key: string) => config[key],
          getOrThrow: (key: string) => config[key] } },
        { provide: ProductionJobsService, useValue: service },
        { provide: APP_GUARD, useClass: OriginCsrfGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('protects owner reads and starts with login and browser CSRF', async () => {
    const body = { numTasks: 10, creatorJobId: id, selectedIndices: [0, 2] };
    await request(app.getHttpServer()).get(`/api/conversations/${id}/production`).expect(401);
    await request(app.getHttpServer()).get(`/api/conversations/${id}/production`)
      .set('Cookie', cookie).expect(200, view);
    await request(app.getHttpServer()).post(`/api/conversations/${id}/production`)
      .set('Cookie', cookie).send(body).expect(403);
    await request(app.getHttpServer()).post(`/api/conversations/${id}/production`)
      .set('Cookie', cookie).set('Origin', 'http://localhost:5173')
      .send(body).expect(200, view);
    expect(service.startForOwner).toHaveBeenCalledWith(id, 'owner', body);
  });

  it('requires the factory token for worker actions', async () => {
    await request(app.getHttpServer()).post('/api/internal/v1/production-jobs/claim').expect(401);
    await request(app.getHttpServer()).post('/api/internal/v1/production-jobs/claim')
      .set('Authorization', 'Bearer factory-token').expect(200, { job: null });
    const body = { lease_token: id, progress_version: 1,
      progress: { phase: 'generating', generated_examples: 4 } };
    await request(app.getHttpServer()).post(`/api/internal/v1/production-jobs/${id}/heartbeat`)
      .set('Authorization', 'Bearer factory-token').send(body).expect(200);
    expect(service.heartbeat).toHaveBeenCalledWith(id, body);
  });
});

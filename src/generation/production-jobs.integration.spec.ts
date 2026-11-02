import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { HttpException } from '@nestjs/common';
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
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkJobsController } from './benchmark-jobs.controller';
import { BenchmarkJobsService } from './benchmark-jobs.service';
import { GenerationController } from './generation.controller';
import { InterviewerServiceTokenGuard } from './interviewer-service-token.guard';
import { ProductionJobsController } from './production-jobs.controller';
import { ProductionJobsService } from './production-jobs.service';
import { ProductionController } from './production.controller';

describe('Producer jobs (PostgreSQL)', () => {
  let db: PGlite;
  let service: ProductionJobsService;
  let prisma: PrismaService;
  const sessionId = '14a2b43e-8935-4077-a30e-635f708d904f';
  const creatorId = 'e55fb605-cf9f-4e61-9df0-c5a1ebad0114';
  const seeds = [{ question: 'Seed 1', answer: 'A' }, { question: 'Seed 2', answer: 'B' }];

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TYPE "ConversationStatus" AS ENUM ('active', 'completed');
      CREATE TABLE conversations (id uuid PRIMARY KEY, user_id text NOT NULL, is_deleted boolean NOT NULL DEFAULT false, status text DEFAULT 'active', intent text DEFAULT 'create_new');
      CREATE TABLE messages (id uuid PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY, role text NOT NULL);
    `);
    await db.exec(readFileSync(resolve('prisma/migrations/20261002010000_add_generation_jobs/migration.sql'), 'utf8'));
    const adapter = (connection: { query: PGlite['query'] }): unknown => ({
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Prisma.sql(strings, ...values);
        return (await connection.query<Record<string, unknown>>(sql.text, sql.values)).rows;
      },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Prisma.sql(strings, ...values);
        return (await connection.query(sql.text, sql.values)).affectedRows;
      },
      $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
        db.transaction((tx) => callback(adapter(tx))),
    });
    prisma = adapter(db) as PrismaService;
    service = new ProductionJobsService(prisma);
  }, 60_000);

  afterAll(async () => { await db?.close(); });

  beforeEach(async () => {
    await db.exec('DELETE FROM benchmark_producer_jobs; DELETE FROM benchmark_creator_jobs; DELETE FROM conversations;');
    await db.exec('DELETE FROM users; INSERT INTO users(id,role) VALUES (\'owner\',\'USER\')');
    await db.query('INSERT INTO conversations(id,user_id) VALUES ($1,$2)', [sessionId, 'owner']);
    await db.query(
      'INSERT INTO benchmark_creator_jobs(id,interview_session_id,brief,status,result,schema_version,request_hash) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,\'1.0\',repeat(\'a\',64))',
      [creatorId, sessionId, JSON.stringify({ schema_version: '1.0' }), 'succeeded',
        JSON.stringify({ status: 'succeeded', source: 'evolution', dataset_type: 'mcqa', examples: seeds })]
    );
  });

  it('requires completed inventor examples', async () => {
    await db.query('UPDATE benchmark_creator_jobs SET status=$1 WHERE id=$2', ['running', creatorId]);
    await expect(service.startForOwner(sessionId, 'owner', { numTasks: 3,
      creatorJobId: creatorId, selectedIndices: [0] }))
      .rejects.toBeInstanceOf(HttpException);
    await db.query('UPDATE benchmark_creator_jobs SET status=$1, result=NULL WHERE id=$2',
      ['succeeded', creatorId]);
    await expect(service.startForOwner(sessionId, 'owner', { numTasks: 3,
      creatorJobId: creatorId, selectedIndices: [0] }))
      .rejects.toBeInstanceOf(HttpException);
  });

  it('denies public and internal production starts for the current DEMO owner', async () => {
    await db.exec('UPDATE users SET role=\'DEMO\'');
    await expect(service.startForOwner(sessionId, 'owner', { numTasks: 4 }))
      .rejects.toMatchObject({ status: 403, response: { error: { code: 'demo_execution_forbidden' } } });
    await expect(service.accept({ interview_session_id: sessionId, creator_job_id: creatorId, numTasks: 4 }))
      .rejects.toMatchObject({ status: 403 });
    expect((await db.query('SELECT count(*)::int AS count FROM benchmark_producer_jobs')).rows[0]).toEqual({ count: 0 });
  });

  it('does not claim DEMO production or publish active worker updates after reassignment', async () => {
    await service.startForOwner(sessionId, 'owner', { numTasks: 4 });
    await db.exec('UPDATE users SET role=\'DEMO\'');
    expect(await service.claim()).toEqual({ job: null });
    await db.exec('UPDATE users SET role=\'USER\'');
    const job = (await service.claim()).job;
    await db.exec('UPDATE users SET role=\'DEMO\'');
    await expect(service.heartbeat(String(job.job_id), { lease_token: job.lease_token, progress: {} }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.complete(String(job.job_id), { lease_token: job.lease_token,
      result: { status: 'succeeded', source: 'producer', examples: seeds } }))
      .rejects.toMatchObject({ status: 409 });
    expect((await service.getForOwner(sessionId, 'owner')).examples).toEqual([]);
  });

  it('accepts an agent request once and retains all latest Inventor seeds', async () => {
    const payload = { interview_session_id: sessionId, creator_job_id: creatorId, numTasks: 4 };
    expect(await service.getBySession(sessionId)).toEqual({ job: null });
    const started = await service.accept(payload);
    expect(await service.accept(payload)).toEqual(started);
    expect(await service.getBySession(sessionId)).toEqual({ job: {
      job_id: started.job_id, creator_job_id: creatorId, status: 'accepted', num_tasks: 4,
    } });
    const claimed = (await service.claim()).job;
    expect(claimed).toMatchObject({ examples: seeds, num_tasks: 4, dataset_type: 'mcqa' });
    expect((await service.accept(payload)).job_id).toBe(started.job_id);
    await service.complete(String(claimed.job_id), { lease_token: claimed.lease_token,
      result: { status: 'succeeded', source: 'producer', examples: seeds } });
    expect(await service.accept(payload)).toMatchObject({ job_id: started.job_id, status: 'succeeded' });
    expect((await db.query('SELECT count(*)::int AS count FROM benchmark_producer_jobs')).rows)
      .toEqual([{ count: 1 }]);
  });

  it('rejects premature or stale agent production and validates the count', async () => {
    const payload = { interview_session_id: sessionId, creator_job_id: creatorId, numTasks: 4 };
    await db.query('UPDATE benchmark_creator_jobs SET status=$1 WHERE id=$2', ['running', creatorId]);
    await expect(service.accept(payload)).rejects.toMatchObject({ status: 409 });
    await db.query('UPDATE benchmark_creator_jobs SET status=$1 WHERE id=$2', ['succeeded', creatorId]);
    await expect(service.accept({ ...payload, creator_job_id: sessionId })).rejects.toMatchObject({ status: 409 });
    for (const numTasks of [true, '4', 0, 3, 1001]) {
      await expect(service.accept({ ...payload, numTasks })).rejects.toMatchObject({ status: 422 });
    }
    await db.exec('DELETE FROM benchmark_creator_jobs');
    await expect(service.accept(payload)).rejects.toMatchObject({ status: 409 });
  });

  it('requires equal variants per selected example, rather than per full Inventor batch', async () => {
    await expect(service.startForOwner(sessionId, 'owner', {
      numTasks: 3, creatorJobId: creatorId, selectedIndices: [0, 1],
    })).rejects.toMatchObject({ response: { error: { code: 'invalid_production_count' } } });
    expect((await service.claim()).job).toBeNull();
    expect(await service.startForOwner(sessionId, 'owner', {
      numTasks: 3, creatorJobId: creatorId, selectedIndices: [1],
    })).toMatchObject({ status: 'queued', requestedCount: 3, selectedIndices: [1] });
  });

  it('accepts a nonempty filtered result below the requested count', async () => {
    await service.startForOwner(sessionId, 'owner', { numTasks: 4 });
    const claimed = (await service.claim()).job;
    const complete = (examples: Record<string, unknown>[]) => service.complete(String(claimed.job_id), {
      lease_token: claimed.lease_token, result: { status: 'succeeded', source: 'producer', examples },
    });
    await expect(complete([])).rejects.toMatchObject({ status: 422 });
    await expect(complete(Array.from({ length: 5 }, () => ({})))).rejects.toMatchObject({ status: 422 });
    const filtered = [{ question: 'Valid unique task' }];
    await complete(filtered);
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({
      status: 'succeeded', requestedCount: 4, generatedCount: 1, examples: filtered,
    });
  });

  it('preserves existing generation jobs when applying the additive migration', async () => {
    const started = await service.startForOwner(sessionId, 'owner', {
      numTasks: 3, creatorJobId: creatorId, selectedIndices: [1],
    });
    await db.exec(readFileSync(resolve('prisma/migrations/20261002010000_add_generation_jobs/migration.sql'), 'utf8'));
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({
      jobId: started.jobId, selectedIndices: [1], requestedCount: 3, status: 'queued',
    });
    expect((await service.claim()).job).toMatchObject({ examples: [seeds[1]], dataset_type: 'mcqa' });
  });

  it('upgrades producer jobs from main without losing seeds, results or Inventor state', async () => {
    const started = await service.startForOwner(sessionId, 'owner', { numTasks: 4 });
    const claimed = (await service.claim()).job;
    const examples = [{ question: 'Already produced' }];
    await service.complete(String(claimed.job_id), { lease_token: claimed.lease_token,
      result: { status: 'succeeded', source: 'producer', examples },
    });
    // main/develop created this same durable table before selection was added.
    await db.exec('ALTER TABLE benchmark_producer_jobs DROP COLUMN selected_indices');
    await db.exec(readFileSync(resolve('prisma/migrations/20261002010000_add_generation_jobs/migration.sql'), 'utf8'));
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({
      jobId: started.jobId, status: 'succeeded', requestedCount: 4, examples, selectedIndices: [0, 1],
    });
    const creator = await db.query<{ result: { examples: unknown[] } }>(
      'SELECT result FROM benchmark_creator_jobs WHERE id=$1', [creatorId]
    );
    expect(creator.rows[0].result.examples).toEqual(seeds);
  });

  it('starts only from inventor results, tracks examples, and preserves inventor output', async () => {
    const initial = await service.getForOwner(sessionId, 'owner');
    expect(initial).toEqual({ jobId: null, status: 'none', requestedCount: null,
      generatedCount: 0, examples: [], error: null, selectedIndices: [] });
    const request = { numTasks: 3, creatorJobId: creatorId, selectedIndices: [1] };
    await expect(service.startForOwner(sessionId, 'other', request)).rejects.toBeInstanceOf(HttpException);
    await expect(service.startForOwner(sessionId, 'owner', { ...request, numTasks: 1001 })).rejects.toBeInstanceOf(HttpException);
    const started = await service.startForOwner(sessionId, 'owner', request);
    expect(started).toMatchObject({ status: 'queued', requestedCount: 3,
      generatedCount: 0, selectedIndices: [1] });
    await expect(service.startForOwner(sessionId, 'owner', request)).rejects.toBeInstanceOf(HttpException);
    const claimed = (await service.claim()).job;
    expect(claimed).toMatchObject({ job_id: started.jobId, interview_session_id: sessionId,
      num_tasks: 3, examples: [seeds[1]], dataset_type: 'mcqa', attempt: 1 });
    await service.heartbeat(String(claimed.job_id), {
      lease_token: claimed.lease_token, progress_version: 1,
      progress: { phase: 'generating', generated_examples: 2 },
    });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'running',
      requestedCount: 3, generatedCount: 2 });
    const produced = [{ question: 'New 1' }, { question: 'New 2' }, { question: 'New 3' }];
    await expect(service.complete(String(claimed.job_id), { lease_token: claimed.lease_token,
      result: { status: 'succeeded', source: 'producer', examples: [...produced, {}] },
    })).rejects.toBeInstanceOf(HttpException);
    await service.complete(String(claimed.job_id), { lease_token: claimed.lease_token,
      result: { status: 'succeeded', source: 'producer', examples: produced },
    });
    expect(await service.getForOwner(sessionId, 'owner')).toEqual({ jobId: started.jobId,
      status: 'succeeded', requestedCount: 3, generatedCount: 3,
      examples: produced, error: null, selectedIndices: [1] });
    const creator = await db.query<{ result: { examples: unknown[] } }>(
      'SELECT result FROM benchmark_creator_jobs WHERE id=$1', [creatorId]
    );
    expect(creator.rows[0].result.examples).toEqual(seeds);
  });

  it('allows a failed production to be retried with a new count and job ID', async () => {
    const first = await service.startForOwner(sessionId, 'owner', { numTasks: 2,
      creatorJobId: creatorId, selectedIndices: [0] });
    const claimed = (await service.claim()).job;
    await service.complete(String(claimed.job_id), { lease_token: claimed.lease_token,
      result: { status: 'failed', error: { code: 'model_error' } },
    });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'failed',
      error: { code: 'model_error' } });
    const retried = await service.startForOwner(sessionId, 'owner', { numTasks: 4,
      creatorJobId: creatorId, selectedIndices: [1] });
    expect(retried).toMatchObject({ status: 'queued', requestedCount: 4,
      generatedCount: 0, selectedIndices: [1] });
    expect(retried.jobId).not.toBe(first.jobId);
    expect((await service.claim()).job).toMatchObject({ job_id: retried.jobId,
      num_tasks: 4, examples: [seeds[1]] });
  });

  it('rejects empty, repeated, out-of-range and stale selections', async () => {
    const request = { numTasks: 3, creatorJobId: creatorId, selectedIndices: [0] };
    const staleCreatorId = '3f85b21d-21c1-4722-a994-756a61501018';
    for (const selectedIndices of [[], [0, 0], [-1], [2], [0.5]]) {
      await expect(service.startForOwner(sessionId, 'owner', { ...request, selectedIndices }))
        .rejects.toBeInstanceOf(HttpException);
    }
    await expect(service.startForOwner(sessionId, 'owner', {
      ...request, creatorJobId: staleCreatorId,
    })).rejects.toMatchObject({ response: { error: { code: 'creator_job_changed' } } });
    expect((await service.getForOwner(sessionId, 'owner')).status).toBe('none');
  });

  it('preserves the full batch for existing clients that omit selection', async () => {
    const started = await service.startForOwner(sessionId, 'owner', { numTasks: 4 });
    expect(started.selectedIndices).toEqual([0, 1]);
    expect((await service.claim()).job).toMatchObject({ examples: seeds });
  });

  it('passes selected examples from the browser HTTP endpoint to the worker claim', async () => {
    const firstBatch = Array.from({ length: 20 }, (_, index) => ({
      question: `Seed ${index + 1}`, answer: `Answer ${index + 1}`,
    }));
    await db.query('UPDATE benchmark_creator_jobs SET result=$1::jsonb WHERE id=$2', [
      JSON.stringify({ status: 'succeeded', source: 'evolution', examples: firstBatch }), creatorId,
    ]);
    const config: Record<string, unknown> = {
      'agent.apiKey': 'factory-test-token', jwtAccessSecret: 'integration-signing-key',
      nodeEnv: 'dev', trustedOrigins: [],
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProductionController, ProductionJobsController, GenerationController, BenchmarkJobsController],
      providers: [JwtStrategy, InterviewerServiceTokenGuard,
        { provide: ConfigService, useValue: { get: (key: string) => config[key],
          getOrThrow: (key: string) => config[key] } },
        { provide: PrismaService, useValue: prisma },
        ProductionJobsService, BenchmarkJobsService,
        { provide: APP_GUARD, useClass: OriginCsrfGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    await app.init();
    try {
      const internalPath = '/api/internal/v1/production-jobs';
      const agentPayload = { interview_session_id: sessionId, creator_job_id: creatorId, numTasks: 100 };
      await request(app.getHttpServer()).post(internalPath).send(agentPayload).expect(401);
      await request(app.getHttpServer()).post(internalPath)
        .set('Authorization', 'Bearer wrong-token').send(agentPayload).expect(401);
      await request(app.getHttpServer()).get(`${internalPath}/session/${sessionId}`).expect(401);
      const agentStarted = await request(app.getHttpServer()).post(internalPath)
        .set('Authorization', 'Bearer factory-test-token').send(agentPayload).expect(201);
      const agentRetried = await request(app.getHttpServer()).post(internalPath)
        .set('Authorization', 'Bearer factory-test-token').send(agentPayload).expect(201);
      expect(agentRetried.body).toEqual(agentStarted.body);
      const agentRead = await request(app.getHttpServer()).get(`${internalPath}/session/${sessionId}`)
        .set('Authorization', 'Bearer factory-test-token').expect(200);
      expect(agentRead.body.job).toMatchObject({ job_id: agentStarted.body.job_id, creator_job_id: creatorId });
      await db.exec('DELETE FROM benchmark_producer_jobs');
      const cookie = `access_token=${new JwtService({ secret: String(config.jwtAccessSecret) })
        .sign({ sub: 'owner', username: 'owner', role: 'user' })}`;
      const started = await request(app.getHttpServer())
        .post(`/api/conversations/${sessionId}/production`)
        .set('Cookie', cookie).set('Origin', 'http://localhost:5173')
        .send({ numTasks: 100, creatorJobId: creatorId, selectedIndices: [1, 19] }).expect(200);
      expect(started.body).toMatchObject({ status: 'queued', selectedIndices: [1, 19] });
      const read = await request(app.getHttpServer())
        .get(`/api/conversations/${sessionId}/production`).set('Cookie', cookie).expect(200);
      expect(read.body.selectedIndices).toEqual([1, 19]);
      const claimed = await request(app.getHttpServer())
        .post('/api/internal/v1/production-jobs/claim')
        .set('Authorization', 'Bearer factory-test-token').expect(200);
      expect(claimed.body.job).toMatchObject({
        examples: [firstBatch[1], firstBatch[19]], num_tasks: 100,
      });
      // The cookie still carries USER after the database role changes.
      await db.exec('UPDATE users SET role=\'DEMO\'');
      await request(app.getHttpServer()).post(`/api/conversations/${sessionId}/production`)
        .set('Cookie', cookie).set('Origin', 'http://localhost:5173')
        .send({ numTasks: 100, creatorJobId: creatorId }).expect(403);
      await request(app.getHttpServer()).post(internalPath)
        .set('Authorization', 'Bearer factory-test-token').send(agentPayload).expect(403);
      await request(app.getHttpServer()).post(`/api/conversations/${sessionId}/generation/retry`)
        .set('Cookie', cookie).set('Origin', 'http://localhost:5173').expect(403);
      await request(app.getHttpServer()).post('/api/internal/v1/benchmark-jobs')
        .set('Authorization', 'Bearer factory-test-token').send({ interview_session_id: sessionId, schema_version: '1.0',
          brief: { schema_version: '1.0', decision: {}, evaluation_target: {}, task_context: {},
            quality_requirements: {}, taxonomy: {}, test: {} }, num_tasks: 2 }).expect(403);
    } finally {
      await app.close();
    }
  });
});

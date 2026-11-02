import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConversationsRepository } from '@/conversations/repository/conversations.repository';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkJobsService } from './benchmark-jobs.service';
import { ProductionJobsService } from './production-jobs.service';

describe('Durable Inventor conversation handoff (PostgreSQL)', () => {
  let db: PGlite;
  let service: BenchmarkJobsService;
  let production: ProductionJobsService;
  let pool: Pool;
  let driver: Awaited<ReturnType<PrismaPg['connect']>>;
  let conversations: ConversationsRepository;
  const sessionId = '14a2b43e-8935-4077-a30e-635f708d904f';
  const brief = { schema_version: '1.0', decision: { type: 'compare_models' },
    evaluation_target: { type: 'model' }, task_context: { real_world_tasks: 'Налоги' },
    quality_requirements: {}, taxonomy: {}, test: { output_format: 'mcqa' } };
  const request = { interview_session_id: sessionId, schema_version: '1.0', brief, num_tasks: 2 };

  beforeAll(async () => {
    db = new PGlite();
    pool = new Pool();
    const transport = jest.spyOn(pool, 'query');
    driver = await new PrismaPg(pool).connect();
    await db.exec(`
      CREATE TYPE "ConversationStatus" AS ENUM ('active', 'completed');
      CREATE TABLE conversations (id uuid PRIMARY KEY, user_id text NOT NULL, is_deleted boolean NOT NULL DEFAULT false,
        status "ConversationStatus" NOT NULL DEFAULT 'active', intent text NOT NULL DEFAULT 'create_new',
        updated_at timestamptz NOT NULL DEFAULT now(), agent_context jsonb);
      CREATE TABLE messages (id uuid PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY, role text NOT NULL);
    `);
    await db.exec(readFileSync(resolve('prisma/migrations/20261002010000_add_generation_jobs/migration.sql'), 'utf8'));
    const adapter = (connection: { query: PGlite['query'] }): unknown => ({
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Prisma.sql(strings, ...values);
        const result = await connection.query<Record<string, unknown>>(sql.text, sql.values);
        // Keep the production driver's type checks: PGlite alone accepts void,
        // whereas PrismaPg rejects it before the job can be persisted.
        transport.mockResolvedValueOnce({
          fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
          rows: result.rows.map((row) => result.fields.map((field) => row[field.name])),
          rowCount: result.affectedRows,
        } as never);
        await driver.queryRaw({ sql: sql.text, args: [], argTypes: [] });
        return result.rows;
      },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Prisma.sql(strings, ...values);
        const result = await connection.query<Record<string, unknown>>(sql.text, sql.values);
        transport.mockResolvedValueOnce({
          fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
          rows: result.rows.map((row) => result.fields.map((field) => row[field.name])),
          rowCount: result.affectedRows,
        } as never);
        return driver.executeRaw({ sql: sql.text, args: [], argTypes: [] });
      },
      $transaction: (callback: (tx: unknown) => Promise<unknown>) => db.transaction((tx) => callback(adapter(tx))),
    });
    service = new BenchmarkJobsService(adapter(db) as PrismaService);
    production = new ProductionJobsService(adapter(db) as PrismaService);
    conversations = new ConversationsRepository(adapter(db) as PrismaService);
  }, 60_000);
  afterAll(async () => {
    await driver?.dispose();
    await pool?.end();
    await db?.close();
    jest.restoreAllMocks();
  });
  beforeEach(async () => {
    await db.exec('DELETE FROM benchmark_producer_jobs; DELETE FROM benchmark_creator_jobs; DELETE FROM conversations;');
    await db.exec('DELETE FROM users; INSERT INTO users(id,role) VALUES (\'owner\',\'USER\')');
    await db.query('INSERT INTO conversations(id,user_id) VALUES ($1,$2)', [sessionId, 'owner']);
  });

  it('submits once, survives reconnect and completes the conversation with real worker result shape', async () => {
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'none', jobId: null, examples: [] });
    const accepted = await service.accept(request);
    expect(await service.accept(request)).toEqual(accepted);
    expect(await service.getBySession(sessionId)).toMatchObject({ job: {
      creator_job_id: accepted.creator_job_id, status: 'accepted', num_tasks: 2,
    } });
    await expect(service.accept({ ...request, num_tasks: 3 })).rejects.toMatchObject({ status: 409 });
    expect((await db.query('SELECT status FROM conversations')).rows).toEqual([{ status: 'generating' }]);
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'queued' });
    const job = (await service.claim()).job;
    expect(job).toMatchObject({ num_tasks: 2, brief, attempt: 1, interview_session_id: sessionId });
    expect(await service.claim()).toEqual({ job: null });
    await service.heartbeat(String(job.job_id), { lease_token: job.lease_token, progress_version: 2,
      progress: { phase: 'generating', completed_generations: 2, total_generations: 3,
        completed_mutations: 4, total_mutations: 9,
        completed_llm_calls: 20, total_llm_calls: 500,
        estimated_completion_at: '2026-09-22T15:00:00Z' } });
    await service.heartbeat(String(job.job_id), { lease_token: job.lease_token, progress_version: 1,
      progress: { phase: 'starting', completed_generations: 0, total_generations: 3 } });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'running',
      progress: { phase: 'generating', completedGenerations: 2, totalGenerations: 3,
        completedMutations: 4, totalMutations: 9, completedLlmCalls: 20, totalLlmCalls: 500,
        estimatedCompletionAt: '2026-09-22T15:00:00.000Z' } });
    const examples = [{ input: 'Вопрос 1', output: 'A' }, { input: 'Вопрос 2', output: 'B' }];
    const result = { status: 'succeeded', source: 'evolution', examples, config: { private: true } };
    await service.complete(String(job.job_id), { lease_token: job.lease_token, result });
    await service.complete(String(job.job_id), { lease_token: job.lease_token, result });
    expect(await service.getForOwner(sessionId, 'owner')).toEqual({
      jobId: job.job_id, status: 'succeeded',
      progress: { phase: 'finished', completedGenerations: 2, totalGenerations: 3,
        completedMutations: 4, totalMutations: 9, completedLlmCalls: 20, totalLlmCalls: 500,
        estimatedCompletionAt: null }, examples, error: null,
    });
    expect((await db.query('SELECT status FROM conversations')).rows).toEqual([{ status: 'completed' }]);
  });

  it('authorizes owners and denies stale workers after reclaim and retry', async () => {
    await expect(service.getForOwner(sessionId, 'someone-else')).rejects.toMatchObject({ status: 404 });
    await expect(service.retryForOwner(sessionId, 'someone-else')).rejects.toMatchObject({ status: 404 });
    await service.accept(request);
    const first = (await service.claim()).job;
    await db.exec('UPDATE benchmark_creator_jobs SET lease_expires_at = now() - interval \'1 second\'');
    const second = (await service.claim()).job;
    expect(second.attempt).toBe(2);
    expect(second.lease_token).not.toBe(first.lease_token);
    await expect(service.heartbeat(String(first.job_id), { lease_token: first.lease_token, progress: {} }))
      .rejects.toMatchObject({ status: 409 });
    await service.fail(String(second.job_id), { lease_token: second.lease_token, error: { code: 'generation_failed' } });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'failed', error: { code: 'generation_failed' } });
    const retried = await service.retryForOwner(sessionId, 'owner');
    expect(retried.status).toBe('queued');
    expect(retried.jobId).not.toBe(first.job_id);
    expect((await service.claim()).job).toMatchObject({ attempt: 1, num_tasks: 2 });
    await expect(service.retryForOwner(sessionId, 'owner')).rejects.toMatchObject({ status: 409 });
  });

  it('denies direct Inventor submit, duplicate submit and retry for the current DEMO owner', async () => {
    await db.exec('UPDATE users SET role = \'DEMO\'');
    await expect(service.accept(request)).rejects.toMatchObject({ status: 403,
      response: { error: { code: 'demo_execution_forbidden' } } });
    expect((await db.query('SELECT count(*)::int AS count FROM benchmark_creator_jobs')).rows[0]).toEqual({ count: 0 });
    await db.exec('UPDATE users SET role = \'USER\'');
    await service.accept(request);
    await db.exec('UPDATE benchmark_creator_jobs SET status=\'failed\'; UPDATE users SET role=\'DEMO\'');
    await expect(service.accept(request)).rejects.toMatchObject({ status: 403 });
    await expect(service.retryForOwner(sessionId, 'owner')).rejects.toMatchObject({ status: 403 });
    expect((await service.getBySession(sessionId)).job?.status).toBe('failed');
  });

  it('does not claim a DEMO job and rejects active worker callbacks after role reassignment', async () => {
    await service.accept(request);
    await db.exec('UPDATE users SET role=\'DEMO\'');
    expect(await service.claim()).toEqual({ job: null });
    await db.exec('UPDATE users SET role=\'USER\'');
    const job = (await service.claim()).job;
    await db.exec('UPDATE users SET role=\'DEMO\'');
    await expect(service.heartbeat(String(job.job_id), { lease_token: job.lease_token, progress: {} }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.complete(String(job.job_id), { lease_token: job.lease_token,
      result: { status: 'succeeded', source: 'evolution', examples: [{ input: 'Q', output: 'A' }] } }))
      .rejects.toMatchObject({ status: 409 });
    expect((await service.getForOwner(sessionId, 'owner')).examples).toEqual([]);
    expect((await db.query('SELECT status FROM conversations')).rows[0]).toEqual({ status: 'generating' });
  });

  it('derives the execution mode from the current owner, ignores context overrides and fails closed for missing users', async () => {
    const context = { executionMode: 'execute', prepared_brief: { internal: 'durable brief' } };
    await db.query('UPDATE conversations SET agent_context=$1::jsonb', [JSON.stringify(context)]);
    expect(await conversations.getAgentContext(sessionId)).toEqual({ agentContext: context, executionMode: 'execute' });
    await db.exec('UPDATE users SET role=\'DEMO\'');
    expect(await conversations.getAgentContext(sessionId)).toEqual({ agentContext: context, executionMode: 'prepare_only' });
    await db.exec('DELETE FROM users');
    expect(await conversations.getAgentContext(sessionId)).toBeNull();
    await expect(service.accept(request)).rejects.toMatchObject({ status: 404 });
    expect(await service.claim()).toEqual({ job: null });
  });

  it('marks expired attempts exhausted without claiming them again', async () => {
    await service.accept(request);
    await db.exec('UPDATE benchmark_creator_jobs SET status = \'running\', attempt = 3, lease_expires_at = now() - interval \'1 second\'');
    expect(await service.claim()).toEqual({ job: null });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'failed', error: { code: 'attempts_exhausted' } });
  });

  it('cancels queued jobs and prevents an old cancel request from stopping a retry', async () => {
    const accepted = await service.accept(request);
    const jobId = accepted.creator_job_id;
    expect(await service.cancelForOwner(sessionId, 'owner', jobId)).toMatchObject({
      status: 'cancelled', progress: { phase: 'cancelled', estimatedCompletionAt: null }, error: null,
    });
    expect(await service.claim()).toEqual({ job: null });
    expect(await service.cancelForOwner(sessionId, 'owner', jobId)).toMatchObject({ status: 'cancelled' });
    const retry = await service.retryForOwner(sessionId, 'owner');
    expect(retry).toMatchObject({ status: 'queued' });
    expect(retry.jobId).not.toBe(jobId);
    await expect(service.cancelForOwner(sessionId, 'owner', jobId)).rejects.toMatchObject({ status: 409 });
    expect((await service.claim()).job).toMatchObject({ job_id: retry.jobId, attempt: 1 });
  });

  it('revokes a running lease and rejects late progress and results after cancellation', async () => {
    await service.accept(request);
    const job = (await service.claim()).job;
    const jobId = String(job.job_id);
    await expect(service.cancelForOwner(sessionId, 'another-user', jobId)).rejects.toMatchObject({ status: 404 });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'running' });
    await service.heartbeat(jobId, { lease_token: job.lease_token, progress: {
      completed_llm_calls: 3, total_llm_calls: 115, estimated_completion_at: '2026-09-22T15:00:00Z',
    } });
    expect(await service.cancelForOwner(sessionId, 'owner', jobId)).toMatchObject({
      status: 'cancelled', progress: { completedLlmCalls: 3, estimatedCompletionAt: null },
    });
    await expect(service.heartbeat(jobId, { lease_token: job.lease_token, progress: {} })).rejects.toMatchObject({ status: 409 });
    await expect(service.complete(jobId, { lease_token: job.lease_token, result: {
      status: 'succeeded', source: 'evolution', examples: [{ input: 'late', output: 'result' }],
    } })).rejects.toMatchObject({ status: 409 });
    expect(await service.claim()).toEqual({ job: null });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ status: 'cancelled', examples: [] });
  });

  it('keeps a completed result when completion wins the cancellation race', async () => {
    await service.accept(request);
    const job = (await service.claim()).job;
    const examples = [{ input: 'question', output: 'answer' }];
    await service.complete(String(job.job_id), { lease_token: job.lease_token,
      result: { status: 'succeeded', source: 'evolution', examples } });
    expect(await service.cancelForOwner(sessionId, 'owner', String(job.job_id))).toMatchObject({ status: 'succeeded', examples });
  });

  it('rejects invalid briefs but accepts a tool generation from the conversational search mode', async () => {
    for (const change of [{ schema_version: '2.0' }, { brief: { label: 'Summary' } }, { num_tasks: 0 }, { num_tasks: 101 }, { num_tasks: '2' }]) {
      await expect(service.accept({ ...request, ...change })).rejects.toMatchObject({ status: 422 });
    }
    await db.exec('UPDATE conversations SET intent = \'find_existing\'');
    await expect(service.accept(request)).resolves.toMatchObject({ status: 'accepted' });
    const state = await db.query('SELECT status, intent FROM conversations');
    expect(state.rows[0]).toMatchObject({ status: 'generating', intent: 'create_new' });
  });

  it('replaces the single inventor row and idempotently accepts revised briefs without schema changes', async () => {
    const first = await service.accept(request);
    const job = (await service.claim()).job;
    const result = { status: 'succeeded', source: 'evolution', examples: [{ input: 'Too easy', output: 'A' }] };
    await service.complete(String(job.job_id), { lease_token: job.lease_token, result });
    const revision = { ...request,
      brief: { ...brief, task_context: { real_world_tasks: 'Сложные практические налоговые задачи' } },
      request_id: 'b89272f5-2300-491b-85a8-bfc97363985b', previous_job_id: first.creator_job_id };
    const second = await service.accept(revision);
    expect(second.creator_job_id).toBe(revision.request_id);
    expect(await service.accept(revision)).toEqual(second);
    expect(await service.accept({ ...revision, request_id: revision.request_id.toUpperCase(),
      previous_job_id: revision.previous_job_id.toUpperCase() })).toEqual(second);
    expect(await service.getBySession(sessionId)).toMatchObject({ job: {
      creator_job_id: second.creator_job_id, brief: revision.brief, request_id: revision.request_id,
    } });
    await expect(service.get(first.creator_job_id)).rejects.toMatchObject({ status: 404 });
    expect((await db.query('SELECT id::text, result, progress, lease_token, attempt FROM benchmark_creator_jobs')).rows)
      .toEqual([{ id: second.creator_job_id, result: null, progress: null, lease_token: null, attempt: 0 }]);
    await expect(service.accept({ ...revision, num_tasks: 3 })).rejects.toMatchObject({ status: 409 });
    await expect(service.accept({ ...revision, request_id: 'a6c04ef7-5220-4f30-a4a5-bd2ff40ff5ba' }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.accept({ ...revision, request_id: 'a6c04ef7-5220-4f30-a4a5-bd2ff40ff5ba',
      previous_job_id: second.creator_job_id })).rejects.toMatchObject({ status: 409 });
    // A retry of an old worker's completion must not finish the new generation.
    await expect(service.complete(String(job.job_id), { lease_token: job.lease_token, result }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.heartbeat(String(job.job_id), { lease_token: job.lease_token, progress: {} }))
      .rejects.toMatchObject({ status: 409 });
    expect((await db.query('SELECT status FROM conversations')).rows[0]).toEqual({ status: 'generating' });
    expect(await service.getForOwner(sessionId, 'owner')).toMatchObject({ jobId: second.creator_job_id, status: 'queued' });
    const revisedJob = (await service.claim()).job;
    const revisedResult = { ...result, examples: [{ input: 'Hard question', output: 'B' }] };
    await service.complete(String(revisedJob.job_id), { lease_token: revisedJob.lease_token, result: revisedResult });
    expect(await service.accept(revision)).toEqual(second);
    // An explicit new run may keep the same brief, but only the latest survives.
    const thirdRequest = { ...revision, request_id: 'bc2700ee-3b44-4de6-93bc-bcd9bde5afdc',
      previous_job_id: second.creator_job_id };
    const third = await service.accept(thirdRequest);
    expect(await service.accept(thirdRequest)).toEqual(third);
    await expect(service.accept(revision)).rejects.toMatchObject({ status: 409 });
    expect((await db.query('SELECT count(*)::int AS count FROM benchmark_creator_jobs')).rows).toEqual([{ count: 1 }]);
  });

  it('waits for a running producer and clears terminal production before replacing its source', async () => {
    const first = await service.accept(request);
    const inventor = (await service.claim()).job;
    const examples = [{ input: 'Original question', output: 'A' }];
    await service.complete(String(inventor.job_id), { lease_token: inventor.lease_token,
      result: { status: 'succeeded', source: 'evolution', examples } });
    const producerRequest = { interview_session_id: sessionId, creator_job_id: first.creator_job_id, numTasks: 2 };
    const started = await production.accept(producerRequest);
    const revision = { ...request, request_id: 'b89272f5-2300-491b-85a8-bfc97363985b',
      previous_job_id: first.creator_job_id,
      brief: { ...brief, task_context: { real_world_tasks: 'Revised tasks' } } };
    await expect(service.accept(revision)).rejects.toMatchObject({
      status: 409, response: { error: { code: 'production_in_progress' } },
    });
    const producer = (await production.claim()).job;
    await expect(service.accept(revision)).rejects.toMatchObject({ status: 409 });
    const producedResult = { status: 'succeeded', source: 'producer', examples };
    await production.complete(String(producer.job_id), { lease_token: producer.lease_token, result: producedResult });
    const second = await service.accept(revision);
    expect(await production.getBySession(sessionId)).toEqual({ job: null });
    await expect(production.complete(String(producer.job_id), { lease_token: producer.lease_token, result: producedResult }))
      .rejects.toMatchObject({ status: 404 });
    await expect(production.accept(producerRequest)).rejects.toMatchObject({ status: 409 });
    const nextInventor = (await service.claim()).job;
    const revisedExamples = [{ input: 'Revised question', output: 'B' }];
    await service.complete(String(nextInventor.job_id), { lease_token: nextInventor.lease_token,
      result: { status: 'succeeded', source: 'evolution', examples: revisedExamples } });
    const nextProduction = await production.accept({ ...producerRequest, creator_job_id: second.creator_job_id });
    expect(nextProduction.job_id).not.toBe(started.job_id);
    expect((await production.claim()).job).toMatchObject({ examples: revisedExamples, brief: revision.brief });
  });
});

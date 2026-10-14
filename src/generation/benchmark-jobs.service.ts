import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { apiError, stableStringify } from './job-contract';

type ExistingJob = {
  id: string;
  request_hash: string;
};

// Lease duration is part of the factory protocol: heartbeat every 20s and stop
// after 60s without renewal. Change these timings together with the worker.
const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 3;

@Injectable()
export class BenchmarkJobsService {
  private readonly logger = new Logger(BenchmarkJobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async claim() {
    const token = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE benchmark_creator_jobs
        SET status = 'failed', updated_at = now(),
            result = '{"status":"failed","error":{"code":"attempts_exhausted"}}'::jsonb
        WHERE status = 'running' AND lease_expires_at <= now() AND attempt >= ${MAX_ATTEMPTS}
      `;
      const jobs = await tx.$queryRaw<Array<Record<string, unknown>>>`
        WITH next_job AS (
          SELECT id FROM benchmark_creator_jobs
          WHERE (status = 'accepted' OR
                (status = 'running' AND lease_expires_at <= now())) AND attempt < ${MAX_ATTEMPTS}
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE benchmark_creator_jobs j
        SET status = 'running', lease_token = CAST(${token} AS uuid),
            lease_expires_at = now() + ${LEASE_SECONDS} * interval '1 second',
            attempt = j.attempt + 1, progress_version = 0, updated_at = now()
        FROM next_job WHERE j.id = next_job.id
        RETURNING j.id::text AS job_id, j.interview_session_id, j.schema_version,
                  j.brief, j.num_tasks, j.lease_token::text, j.attempt, j.progress
      `;
      return { job: jobs[0] ?? null };
    });
  }

  async get(id: string) {
    const jobs = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id::text AS job_id, interview_session_id, schema_version, status,
             attempt, progress, result, num_tasks, created_at, updated_at
      FROM benchmark_creator_jobs WHERE id = CAST(${id} AS uuid)
    `;
    if (!jobs[0]) throw apiError(404, 'job_not_found', 'Inventor job not found');
    return jobs[0];
  }

  async getBySession(sessionId: string) {
    const jobs = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id::text AS creator_job_id, status, num_tasks
      FROM benchmark_creator_jobs WHERE interview_session_id = ${sessionId}
    `;
    return { job: jobs[0] ?? null };
  }

  private async assertOwner(sessionId: string, userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM conversations
      WHERE id::text = ${sessionId} AND user_id = ${userId}
    `;
    if (!rows[0]) throw apiError(404, 'conversation_not_found', 'Conversation not found');
  }

  async getForOwner(sessionId: string, userId: string) {
    await this.assertOwner(sessionId, userId);
    const view = await this.getProgressForSession(sessionId);
    return {
      jobId: view?.job_id ?? null,
      status: 'accepted' === view?.status ? 'queued' : view?.status ?? 'none',
      progress: {
        phase: view?.phase ?? null,
        completedGenerations: view?.completed_generations ?? 0,
        totalGenerations: view?.total_generations ?? null,
        completedMutations: view?.completed_mutations ?? 0,
        totalMutations: view?.total_mutations ?? null,
        completedLlmCalls: view?.completed_llm_calls ?? 0,
        totalLlmCalls: view?.total_llm_calls ?? null,
        estimatedCompletionAt: view?.estimated_completion_at ?? null,
      },
      examples: view?.examples ?? [],
      error: view?.error_code ? { code: view.error_code } : null,
    };
  }

  async retryForOwner(sessionId: string, userId: string) {
    await this.assertOwner(sessionId, userId);
    // A fresh job UUID keeps worker directories and Redis populations from
    // replaying the failed attempt's cached result.json.
    const jobId = randomUUID();
    const updated = await this.prisma.$executeRaw`
      UPDATE benchmark_creator_jobs SET id = CAST(${jobId} AS uuid),
        status = 'accepted', attempt = 0, lease_token = NULL, lease_expires_at = NULL,
        progress = NULL, progress_version = 0, result = NULL, result_hash = NULL,
        updated_at = now()
      WHERE interview_session_id = ${sessionId} AND status IN ('failed', 'cancelled')
    `;
    if (!updated) throw apiError(409, 'job_not_failed', 'Only a failed or cancelled generation can be retried');
    this.logger.log({ event: 'inventor.job.retry', conversationId: sessionId, jobId });
    return this.getForOwner(sessionId, userId);
  }

  async cancelForOwner(sessionId: string, userId: string, jobId: string) {
    await this.assertOwner(sessionId, userId);
    // A conditional update races safely with claim/complete. Revoke the lease
    // so the worker stops on its next heartbeat and cannot publish a late result.
    const updated = await this.prisma.$executeRaw`
      UPDATE benchmark_creator_jobs
      SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
          result = '{"status":"cancelled"}'::jsonb, result_hash = NULL,
          progress = (COALESCE(progress, '{}'::jsonb) - 'result') ||
            '{"phase":"cancelled","estimated_completion_at":null}'::jsonb,
          updated_at = now()
      WHERE interview_session_id = ${sessionId} AND id = CAST(${jobId} AS uuid)
        AND status IN ('accepted', 'running')
    `;
    const current = await this.getForOwner(sessionId, userId);
    if (current.jobId !== jobId) {
      throw apiError(409, 'job_changed', 'Generation has changed; refresh its status');
    }
    if (updated) this.logger.log({ event: 'inventor.job.cancelled', conversationId: sessionId, jobId });
    // Repeated cancellation is idempotent; an already completed result survives.
    return current;
  }

  // Call only after the interviewer has authorized this session for the actor.
  async getProgressForSession(sessionId: string) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id::text AS job_id, status, attempt, updated_at,
             progress->>'phase' AS phase,
             progress->'completed_generations' AS completed_generations,
             progress->'total_generations' AS total_generations,
             progress->'completed_mutations' AS completed_mutations,
             progress->'total_mutations' AS total_mutations,
             progress->'completed_llm_calls' AS completed_llm_calls,
             progress->'total_llm_calls' AS total_llm_calls,
             progress->>'estimated_completion_at' AS estimated_completion_at,
             CASE WHEN jsonb_typeof(result->'examples') = 'array'
               THEN jsonb_array_length(result->'examples') ELSE NULL END AS examples_count,
             result->'error'->>'code' AS error_code,
             CASE WHEN status = 'succeeded' THEN result->'examples' ELSE NULL END AS examples
      FROM benchmark_creator_jobs WHERE interview_session_id = ${sessionId}
    `;
    const row = rows[0];
    if (!row) return null;
    const total = Number.isInteger(row.total_generations) && Number(row.total_generations) > 0
      ? Math.min(200, Number(row.total_generations)) : null;
    const completed = Number.isInteger(row.completed_generations)
      ? Math.max(0, Math.min(total ?? 200, Number(row.completed_generations))) : 0;
    const totalMutations = Number.isInteger(row.total_mutations) && Number(row.total_mutations) > 0
      ? Math.min(2000, Number(row.total_mutations)) : null;
    const completedMutations = Number.isInteger(row.completed_mutations)
      ? Math.max(0, Math.min(totalMutations ?? 2000, Number(row.completed_mutations))) : 0;
    const estimate = 'string' === typeof row.estimated_completion_at
      ? Date.parse(row.estimated_completion_at) : NaN;
    const totalLlmCalls = Number.isSafeInteger(row.total_llm_calls) && Number(row.total_llm_calls) > 0
      ? Number(row.total_llm_calls) : null;
    const completedLlmCalls = Number.isSafeInteger(row.completed_llm_calls)
      ? Math.max(0, Number(row.completed_llm_calls)) : 0;
    const estimatedCompletionAt = 'running' === row.status && ['starting', 'generating'].includes(String(row.phase))
      && completedLlmCalls > 0 && totalLlmCalls !== null && completedLlmCalls < totalLlmCalls
      && Number.isFinite(estimate) ? new Date(estimate).toISOString() : null;
    // Only completed examples are public to the authorized owner, never the
    // surrounding result config, brief, credentials or lease details.
    return {
      job_id: row.job_id,
      status: row.status,
      attempt: row.attempt,
      phase: row.phase,
      completed_generations: completed,
      total_generations: total,
      completed_mutations: completedMutations,
      total_mutations: totalMutations,
      completed_llm_calls: completedLlmCalls,
      total_llm_calls: totalLlmCalls,
      estimated_completion_at: estimatedCompletionAt,
      examples_count: row.examples_count,
      error_code: row.error_code,
      updated_at: row.updated_at,
      ...('succeeded' === row.status && Array.isArray(row.examples)
        ? { examples: row.examples } : {}),
    };
  }

  async heartbeat(id: string, value: unknown) {
    const body = this.workerBody(value);
    const progress = this.jsonObject(body.progress, 'progress');
    // Missing version supports workers deployed before this migration. Once a
    // versioned update is stored, legacy/unordered updates cannot replace it.
    const version = body.progress_version ?? 0;
    if (!Number.isInteger(version) || Number(version) < 0 || Number(version) > 2147483647) {
      throw apiError(422, 'invalid_progress_version', 'progress_version must be a non-negative 32-bit integer');
    }
    const updated = await this.prisma.$executeRaw`
      UPDATE benchmark_creator_jobs
      SET lease_expires_at = now() + ${LEASE_SECONDS} * interval '1 second',
          progress = CASE WHEN ${version} > progress_version OR (${version} = 0 AND progress_version = 0)
            THEN CAST(${JSON.stringify(progress)} AS jsonb) ELSE progress END,
          progress_version = GREATEST(progress_version, ${version}), updated_at = now()
      WHERE id = CAST(${id} AS uuid) AND status = 'running'
        AND lease_token = CAST(${body.lease_token} AS uuid) AND lease_expires_at > now()
    `;
    if (!updated) throw apiError(409, 'lease_lost', 'Inventor lease is no longer active');
    return { status: 'accepted' };
  }

  async complete(id: string, value: unknown) {
    const body = this.workerBody(value);
    const result = this.jsonObject(body.result, 'result');
    if (result.status !== 'succeeded' && result.status !== 'failed') {
      throw apiError(422, 'invalid_result', 'Result must be succeeded or failed');
    }
    if ('failed' === result.status) {
      const error = result.error as Record<string, unknown> | undefined;
      if (!error || typeof error !== 'object' || Array.isArray(error) ||
          typeof error.code !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(error.code) ||
          (error.message !== undefined && (typeof error.message !== 'string' || error.message.length > 2048)) ||
          Object.keys(error).some((key) => !['code', 'message'].includes(key))) {
        throw apiError(422, 'invalid_result', 'Failed result requires error.code and optional error.message (up to 2048 characters)');
      }
    }
    if ('succeeded' === result.status && (
      result.source !== 'evolution' ||
      !Array.isArray(result.examples) || result.examples.length < 1 ||
      result.examples.length > 100 ||
      result.examples.some((example: unknown) => !example || typeof example !== 'object' || Array.isArray(example))
    )) {
      throw apiError(422, 'invalid_result', 'Expected 1 to 100 evolved examples');
    }
    const hash = createHash('sha256').update(stableStringify(result)).digest('hex');
    const updated = await this.prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE benchmark_creator_jobs
        SET status = ${result.status}, result = CAST(${JSON.stringify(result)} AS jsonb),
            result_hash = ${hash}, lease_expires_at = NULL,
            progress = (COALESCE(progress, '{}'::jsonb) - 'result') || '{"phase":"finished"}'::jsonb,
            updated_at = now()
        WHERE id = CAST(${id} AS uuid) AND lease_token = CAST(${body.lease_token} AS uuid)
          AND ((status = 'running' AND lease_expires_at > now()) OR
               (status IN ('succeeded', 'failed') AND result_hash = ${hash}))
      `;
      if (count && 'succeeded' === result.status) {
        await tx.$executeRaw`
          UPDATE conversations SET status = 'completed', updated_at = now()
          WHERE id::text = (SELECT interview_session_id FROM benchmark_creator_jobs WHERE id = CAST(${id} AS uuid))
            AND status = 'generating'
        `;
      }
      return count;
    });
    if (!updated) throw apiError(409, 'lease_lost', 'Lease lost or result differs from the saved result');
    this.logger.log({ event: 'inventor.job.complete', jobId: id, status: result.status,
      examplesCount: Array.isArray(result.examples) ? result.examples.length : 0 });
    return { status: result.status, job_id: id };
  }

  async fail(id: string, value: unknown) {
    const body = this.workerBody(value);
    return this.complete(id, { lease_token: body.lease_token,
      result: { status: 'failed', error: body.error } });
  }

  private jsonObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw apiError(422, 'invalid_job_update', `${field} must be an object`);
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 6 * 1024 * 1024) {
      throw apiError(413, 'job_update_too_large', `${field} exceeds 6 MiB`);
    }
    return value as Record<string, unknown>;
  }

  private workerBody(value: unknown): Record<string, unknown> & { lease_token: string } {
    const body = this.jsonObject(value, 'body');
    if (typeof body.lease_token !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.lease_token)) {
      throw apiError(422, 'invalid_lease_token', 'lease_token must be a UUID');
    }
    return { ...body, lease_token: body.lease_token };
  }

  async accept(body: unknown) {
    const request = this.validate(body);
    const requestHash = createHash('sha256')
      .update(stableStringify(request))
      .digest('hex');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // The lock returns PostgreSQL void, which Prisma cannot deserialize.
          // Execute it for its side effect within this transaction.
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${request.interview_session_id}, 0)
            )
          `;
          const conversations = await tx.$queryRaw<Array<{ status: string; intent: string }>>`
            SELECT status, intent FROM conversations
            WHERE id::text = ${request.interview_session_id} FOR UPDATE
          `;
          if (!conversations[0]) {
            throw apiError(404, 'conversation_not_found', 'Conversation not found');
          }
          const existing = await tx.$queryRaw<ExistingJob[]>`
            SELECT id::text, request_hash
            FROM benchmark_creator_jobs
            WHERE interview_session_id = ${request.interview_session_id}
            LIMIT 1
          `;
          if (existing[0]) {
            if (existing[0].request_hash !== requestHash) {
              throw apiError(
                409,
                'creator_job_conflict',
                'Interview session was already submitted with a different brief'
              );
            }
            return {
              status: 'accepted',
              creator_job_id: existing[0].id,
            };
          }
          if (!['active', 'awaiting_choice'].includes(conversations[0].status)) {
            throw apiError(409, 'conversation_not_active', 'Conversation cannot start generation');
          }
          const id = randomUUID();
          await tx.$executeRaw`
            INSERT INTO benchmark_creator_jobs (
              id,
              interview_session_id,
              schema_version,
              brief,
              request_hash,
              status,
              num_tasks
            ) VALUES (
              CAST(${id} AS uuid),
              ${request.interview_session_id},
              ${request.schema_version},
              CAST(${JSON.stringify(request.brief)} AS jsonb),
              ${requestHash},
              'accepted',
              ${request.num_tasks}
            )
          `;
          await tx.$executeRaw`
            UPDATE conversations SET status = 'generating', intent = 'create_new', updated_at = now()
            WHERE id::text = ${request.interview_session_id}
          `;
          this.logger.log({ event: 'inventor.job.accepted', conversationId: request.interview_session_id,
            jobId: id, numTasks: request.num_tasks });
          return { status: 'accepted', creator_job_id: id };
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to persist creator job: ${(error as Error).message}`
      );
      throw apiError(
        503,
        'creator_unavailable',
        'Benchmark creator job storage is unavailable'
      );
    }
  }

  private validate(value: unknown): {
    interview_session_id: string;
    schema_version: string;
    brief: Record<string, unknown>;
    num_tasks: number | null;
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw apiError(422, 'invalid_creator_job', 'Request body must be an object');
    }
    const body = value as Record<string, unknown>;
    if (
      typeof body.interview_session_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.interview_session_id)
    ) {
      throw apiError(
        422,
        'invalid_creator_job',
        'interview_session_id must be a conversation UUID'
      );
    }
    if (
      body.schema_version !== '1.0'
    ) {
      throw apiError(422, 'invalid_creator_job', 'schema_version must be 1.0');
    }
    if (!body.brief || typeof body.brief !== 'object' || Array.isArray(body.brief)) {
      throw apiError(422, 'invalid_creator_job', 'brief must be an object');
    }
    const brief = this.jsonObject(body.brief, 'brief');
    // Factory owns full BenchmarkBrief semantic validation. Reject the old
    // free-text summary/draft contract at the durable handoff boundary too.
    for (const key of ['decision', 'evaluation_target', 'task_context', 'quality_requirements', 'taxonomy', 'test']) {
      if (!brief[key] || typeof brief[key] !== 'object' || Array.isArray(brief[key])) {
        throw apiError(422, 'invalid_creator_job', `Final brief requires ${key}`);
      }
    }
    if (brief.schema_version !== '1.0') throw apiError(422, 'invalid_creator_job', 'brief.schema_version must be 1.0');
    const numTasks = body.num_tasks ?? null;
    if (numTasks !== null && (!Number.isInteger(numTasks) || Number(numTasks) < 1 || Number(numTasks) > 100)) {
      throw apiError(422, 'invalid_creator_job', 'num_tasks must be an integer from 1 to 100');
    }
    return {
      interview_session_id: body.interview_session_id,
      schema_version: body.schema_version,
      brief: body.brief as Record<string, unknown>,
      num_tasks: numTasks as number | null,
    };
  }
}

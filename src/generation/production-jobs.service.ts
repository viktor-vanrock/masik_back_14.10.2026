import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { apiError, stableStringify } from './job-contract';

const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 3;
const MAX_RESULT_BYTES = 32 * 1024 * 1024;

type ProductionStatus = 'accepted' | 'running' | 'succeeded' | 'failed';

type ProductionRow = {
  job_id: string;
  status: ProductionStatus;
  requested_count: number;
  selected_indices: number[];
  generated_examples: number | null;
  examples: Record<string, unknown>[] | null;
  error: { code?: string; message?: string } | null;
};

@Injectable()
export class ProductionJobsService {
  private readonly logger = new Logger(ProductionJobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getForOwner(sessionId: string, userId: string) {
    await this.assertOwner(sessionId, userId);
    const rows = await this.prisma.$queryRaw<ProductionRow[]>`
      SELECT id::text AS job_id, status, requested_count, selected_indices,
             progress->'generated_examples' AS generated_examples,
             CASE WHEN status = 'succeeded' THEN result->'examples' ELSE NULL END AS examples,
             CASE WHEN status = 'failed' THEN result->'error' ELSE NULL END AS error
      FROM benchmark_producer_jobs WHERE interview_session_id = ${sessionId}
    `;
    const row = rows[0];
    if (!row) return {
      jobId: null, status: 'none', requestedCount: null, generatedCount: 0,
      selectedIndices: [],
      examples: [], error: null,
    };
    const examples = Array.isArray(row.examples) ? row.examples : [];
    const generatedCount = 'succeeded' === row.status
      ? examples.length
      : Number.isInteger(row.generated_examples)
        ? Math.max(0, Math.min(row.requested_count, Number(row.generated_examples))) : 0;
    return {
      jobId: row.job_id,
      status: 'accepted' === row.status ? 'queued' : row.status,
      requestedCount: row.requested_count,
      selectedIndices: row.selected_indices,
      generatedCount,
      examples,
      error: row.error?.code ? row.error : null,
    };
  }

  async startForOwner(sessionId: string, userId: string, value: unknown) {
    const { requestedCount, creatorJobId, selectedIndices } = this.validateStart(value);
    const jobId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      // Lock the conversation so concurrent starts cannot create two producer jobs.
      const owners = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text FROM conversations
        WHERE id::text = ${sessionId} AND user_id = ${userId} FOR UPDATE
      `;
      if (!owners[0]) throw apiError(404, 'conversation_not_found', 'Conversation not found');
      const creators = await tx.$queryRaw<Array<{
        creator_job_id: string;
        brief: Record<string, unknown>;
        examples: Record<string, unknown>[] | null;
      }>>`
        SELECT id::text AS creator_job_id, brief, result->'examples' AS examples
        FROM benchmark_creator_jobs
        WHERE interview_session_id = ${sessionId} AND status = 'succeeded'
      `;
      const creator = creators[0];
      if (!creator || !Array.isArray(creator.examples) || 0 === creator.examples.length) {
        throw apiError(409, 'inventor_result_required', 'Inventor results must be ready before scaling');
      }
      const examples = creator.examples;
      if (creatorJobId !== undefined && creator.creator_job_id !== creatorJobId) {
        throw apiError(409, 'creator_job_changed', 'Generation has changed; refresh its results');
      }
      const indices = selectedIndices ?? examples.map((_, index) => index);
      if (indices.some((index) => index >= examples.length)) {
        throw apiError(422, 'invalid_production_request', 'selectedIndices must refer to generated examples');
      }
      const seedExamples = indices.map((index) => examples[index]);
      if (requestedCount < seedExamples.length || requestedCount % seedExamples.length !== 0) {
        throw apiError(422, 'invalid_production_count',
          `numTasks must be a multiple of the ${seedExamples.length} selected Inventor examples`);
      }
      const existing = await tx.$queryRaw<Array<{ status: ProductionStatus }>>`
        SELECT status FROM benchmark_producer_jobs WHERE interview_session_id = ${sessionId}
      `;
      if (existing[0] && existing[0].status !== 'failed') {
        throw apiError(409, 'production_already_started', 'Production is already running or completed');
      }
      if (existing[0]) {
        // A new UUID isolates retries from old worker files and revoked leases.
        await tx.$executeRaw`
          UPDATE benchmark_producer_jobs SET id = CAST(${jobId} AS uuid),
            creator_job_id = CAST(${creator.creator_job_id} AS uuid),
            brief = CAST(${JSON.stringify(creator.brief)} AS jsonb),
            seed_examples = CAST(${JSON.stringify(seedExamples)} AS jsonb),
            selected_indices = CAST(${JSON.stringify(indices)} AS jsonb),
            requested_count = ${requestedCount}, status = 'accepted',
            lease_token = NULL, lease_expires_at = NULL, attempt = 0,
            progress = NULL, progress_version = 0, result = NULL, result_hash = NULL,
            created_at = now(), updated_at = now()
          WHERE interview_session_id = ${sessionId} AND status = 'failed'
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO benchmark_producer_jobs (
            id, interview_session_id, creator_job_id, brief, seed_examples, selected_indices,
            requested_count, status
          ) VALUES (
            CAST(${jobId} AS uuid), ${sessionId}, CAST(${creator.creator_job_id} AS uuid),
            CAST(${JSON.stringify(creator.brief)} AS jsonb),
            CAST(${JSON.stringify(seedExamples)} AS jsonb),
            CAST(${JSON.stringify(indices)} AS jsonb),
            ${requestedCount}, 'accepted'
          )
        `;
      }
    });
    this.logger.log({ event: 'producer.job.accepted', conversationId: sessionId,
      jobId, requestedCount });
    return this.getForOwner(sessionId, userId);
  }

  async claim() {
    const token = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE benchmark_producer_jobs
        SET status = 'failed', updated_at = now(), lease_token = NULL,
            lease_expires_at = NULL,
            result = '{"status":"failed","error":{"code":"attempts_exhausted"}}'::jsonb
        WHERE status = 'running' AND lease_expires_at <= now() AND attempt >= ${MAX_ATTEMPTS}
      `;
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
        WITH next_job AS (
          SELECT id FROM benchmark_producer_jobs
          WHERE (status = 'accepted' OR
                (status = 'running' AND lease_expires_at <= now()))
            AND attempt < ${MAX_ATTEMPTS}
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE benchmark_producer_jobs j
        SET status = 'running', lease_token = CAST(${token} AS uuid),
            lease_expires_at = now() + ${LEASE_SECONDS} * interval '1 second',
            attempt = j.attempt + 1, progress_version = 0,
            progress = '{"phase":"starting","generated_examples":0}'::jsonb,
            updated_at = now()
        FROM next_job, benchmark_creator_jobs creator
        WHERE j.id = next_job.id AND creator.id = j.creator_job_id
        RETURNING j.id::text AS job_id, j.interview_session_id,
                  j.requested_count AS num_tasks, j.brief,
                  j.seed_examples AS examples,
                  creator.result->>'dataset_type' AS dataset_type,
                  j.lease_token::text,
                  j.attempt, j.progress
      `;
      return { job: rows[0] ?? null };
    });
  }

  async heartbeat(id: string, value: unknown) {
    const body = this.workerBody(value);
    const progress = this.jsonObject(body.progress, 'progress', 1024 * 1024);
    if (progress.generated_examples !== undefined &&
        (!Number.isInteger(progress.generated_examples) ||
          Number(progress.generated_examples) < 0 || Number(progress.generated_examples) > 1000)) {
      throw apiError(422, 'invalid_progress', 'generated_examples must be an integer from 0 to 1000');
    }
    const version = body.progress_version ?? 0;
    if (!Number.isInteger(version) || Number(version) < 0 || Number(version) > 2147483647) {
      throw apiError(422, 'invalid_progress_version', 'progress_version must be a non-negative 32-bit integer');
    }
    const updated = await this.prisma.$executeRaw`
      UPDATE benchmark_producer_jobs
      SET lease_expires_at = now() + ${LEASE_SECONDS} * interval '1 second',
          progress = CASE WHEN ${version} > progress_version OR (${version} = 0 AND progress_version = 0)
            THEN COALESCE(progress, '{}'::jsonb) || CAST(${JSON.stringify(progress)} AS jsonb)
            ELSE progress END,
          progress_version = GREATEST(progress_version, ${version}), updated_at = now()
      WHERE id = CAST(${id} AS uuid) AND status = 'running'
        AND lease_token = CAST(${body.lease_token} AS uuid) AND lease_expires_at > now()
    `;
    if (!updated) throw apiError(409, 'lease_lost', 'Producer lease is no longer active');
    return { status: 'accepted' };
  }

  async complete(id: string, value: unknown) {
    const body = this.workerBody(value);
    const result = this.jsonObject(body.result, 'result', MAX_RESULT_BYTES);
    if (result.status !== 'succeeded' && result.status !== 'failed') {
      throw apiError(422, 'invalid_result', 'Result must be succeeded or failed');
    }
    if ('succeeded' === result.status) {
      if (result.source !== 'producer' || !Array.isArray(result.examples) ||
          result.examples.length < 1 || result.examples.length > 1000 ||
          result.examples.some((example: unknown) =>
            !example || typeof example !== 'object' || Array.isArray(example))) {
        throw apiError(422, 'invalid_result', 'Expected 1 to 1000 produced examples');
      }
      const rows = await this.prisma.$queryRaw<Array<{ requested_count: number }>>`
        SELECT requested_count FROM benchmark_producer_jobs WHERE id = CAST(${id} AS uuid)
      `;
      if (!rows[0]) throw apiError(404, 'job_not_found', 'Producer job not found');
      if (result.examples.length > rows[0].requested_count) {
        throw apiError(422, 'wrong_example_count', 'Produced example count must not exceed the request');
      }
    } else {
      const error = result.error;
      if (!error || typeof error !== 'object' || Array.isArray(error) ||
          typeof (error as Record<string, unknown>).code !== 'string' ||
          !/^[a-z][a-z0-9_]{0,127}$/.test((error as Record<string, string>).code) ||
          ((error as Record<string, unknown>).message !== undefined &&
            (typeof (error as Record<string, unknown>).message !== 'string' ||
              String((error as Record<string, unknown>).message).length > 2048)) ||
          Object.keys(error).some((key) => !['code', 'message'].includes(key))) {
        throw apiError(422, 'invalid_result', 'Failed result requires error.code and optional message');
      }
    }
    const hash = createHash('sha256').update(stableStringify(result)).digest('hex');
    const updated = await this.prisma.$executeRaw`
      UPDATE benchmark_producer_jobs
      SET status = ${result.status}, result = CAST(${JSON.stringify(result)} AS jsonb),
          result_hash = ${hash}, lease_expires_at = NULL,
          progress = (COALESCE(progress, '{}'::jsonb) ||
            CAST(${JSON.stringify({ phase: 'finished', generated_examples:
              'succeeded' === result.status ? (result.examples as unknown[]).length : undefined })} AS jsonb)),
          updated_at = now()
      WHERE id = CAST(${id} AS uuid) AND lease_token = CAST(${body.lease_token} AS uuid)
        AND ((status = 'running' AND lease_expires_at > now()) OR
             (status IN ('succeeded', 'failed') AND result_hash = ${hash}))
    `;
    if (!updated) throw apiError(409, 'lease_lost', 'Lease lost or result differs from saved result');
    this.logger.log({ event: 'producer.job.complete', jobId: id, status: result.status,
      examplesCount: Array.isArray(result.examples) ? result.examples.length : 0 });
    return { status: result.status, job_id: id };
  }

  private async assertOwner(sessionId: string, userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM conversations
      WHERE id::text = ${sessionId} AND user_id = ${userId}
    `;
    if (!rows[0]) throw apiError(404, 'conversation_not_found', 'Conversation not found');
  }

  private validateStart(value: unknown): {
    requestedCount: number; creatorJobId?: string; selectedIndices?: number[];
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw apiError(422, 'invalid_production_request', 'Request body must be an object');
    }
    const body = value as Record<string, unknown>;
    const requestedCount = body.numTasks;
    if (!Number.isInteger(requestedCount) || Number(requestedCount) < 1 || Number(requestedCount) > 1000) {
      throw apiError(422, 'invalid_production_request', 'numTasks must be an integer from 1 to 1000');
    }
    const creatorJobId = body.creatorJobId;
    if (creatorJobId !== undefined && (typeof creatorJobId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(creatorJobId))) {
      throw apiError(422, 'invalid_production_request', 'creatorJobId must be a UUID');
    }
    const selectedIndices = body.selectedIndices;
    if (selectedIndices !== undefined && creatorJobId === undefined) {
      throw apiError(422, 'invalid_production_request',
        'creatorJobId is required with selectedIndices');
    }
    if (selectedIndices !== undefined && (!Array.isArray(selectedIndices) || selectedIndices.length < 1 ||
        selectedIndices.length > 100 ||
        selectedIndices.some((index) => !Number.isInteger(index) || index < 0) ||
        new Set(selectedIndices).size !== selectedIndices.length)) {
      throw apiError(422, 'invalid_production_request',
        'selectedIndices must contain unique non-negative indices');
    }
    return { requestedCount: requestedCount as number,
      creatorJobId: creatorJobId?.toLowerCase(),
      selectedIndices: selectedIndices as number[] | undefined };
  }

  private jsonObject(value: unknown, field: string, maxBytes: number): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw apiError(422, 'invalid_job_update', `${field} must be an object`);
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
      throw apiError(413, 'job_update_too_large', `${field} exceeds the size limit`);
    }
    return value as Record<string, unknown>;
  }

  private workerBody(value: unknown): Record<string, unknown> & { lease_token: string } {
    const body = this.jsonObject(value, 'body', MAX_RESULT_BYTES + 1024);
    if (typeof body.lease_token !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.lease_token)) {
      throw apiError(422, 'invalid_lease_token', 'lease_token must be a UUID');
    }
    return { ...body, lease_token: body.lease_token };
  }
}

-- Generation belongs to conversations in Catalog. These jobs never write
-- Benchmark Service aggregates and do not restore the legacy vector triggers.
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'generating';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "interview_state" JSONB;

CREATE TABLE IF NOT EXISTS benchmark_creator_jobs (
  id UUID PRIMARY KEY,
  interview_session_id TEXT NOT NULL UNIQUE,
  schema_version VARCHAR(160) NOT NULL,
  brief JSONB NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status VARCHAR(32) NOT NULL CHECK (status IN ('accepted', 'running', 'succeeded', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ(6),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  progress JSONB,
  result JSONB,
  result_hash CHAR(64),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  progress_version INTEGER NOT NULL DEFAULT 0 CHECK (progress_version >= 0),
  num_tasks INTEGER CHECK (num_tasks BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS benchmark_creator_jobs_pending_idx
  ON benchmark_creator_jobs (created_at) WHERE status IN ('accepted', 'running');

CREATE TABLE IF NOT EXISTS benchmark_producer_jobs (
  id UUID PRIMARY KEY,
  interview_session_id TEXT NOT NULL UNIQUE,
  creator_job_id UUID NOT NULL REFERENCES benchmark_creator_jobs(id),
  brief JSONB NOT NULL,
  seed_examples JSONB NOT NULL,
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 1000),
  status VARCHAR(32) NOT NULL CHECK (status IN ('accepted', 'running', 'succeeded', 'failed')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ(6),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  progress JSONB,
  progress_version INTEGER NOT NULL DEFAULT 0 CHECK (progress_version >= 0),
  result JSONB,
  result_hash CHAR(64),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS benchmark_producer_jobs_pending_idx
  ON benchmark_producer_jobs (created_at) WHERE status IN ('accepted', 'running');

ALTER TABLE benchmark_producer_jobs
  ADD COLUMN IF NOT EXISTS selected_indices JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Jobs created before selected examples were supported used every seed.
UPDATE benchmark_producer_jobs AS job
SET selected_indices = COALESCE((
  SELECT jsonb_agg(position - 1 ORDER BY position)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(job.seed_examples) = 'array'
    THEN job.seed_examples ELSE '[]'::jsonb END)
    WITH ORDINALITY AS example(value, position)
), '[]'::jsonb)
WHERE selected_indices = '[]'::jsonb;

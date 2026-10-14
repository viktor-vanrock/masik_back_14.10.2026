-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM (
  'benchmark_view',
  'benchmark_test_view',
  'catalog_search',
  'filter_usage'
);

-- CreateTable
CREATE TABLE "analytics_events" (
  "id" UUID NOT NULL,
  "type" "AnalyticsEventType" NOT NULL,
  "benchmark_id" VARCHAR(160),
  "benchmark_test_id" VARCHAR(160),
  "user_id" VARCHAR(160),
  "session_id_hash" VARCHAR(64),
  "ip_hash" VARCHAR(64),
  "user_agent" VARCHAR(1000),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "event_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_events_type_created_at_idx" ON "analytics_events"("type", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_benchmark_id_type_created_at_idx" ON "analytics_events"("benchmark_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_benchmark_test_id_type_created_at_idx" ON "analytics_events"("benchmark_test_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_event_date_idx" ON "analytics_events"("event_date");

-- CreateIndex
CREATE INDEX "analytics_events_user_id_idx" ON "analytics_events"("user_id");

-- AddForeignKey
ALTER TABLE "analytics_events"
ADD CONSTRAINT "analytics_events_benchmark_id_fkey"
FOREIGN KEY ("benchmark_id") REFERENCES "benchmarks"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events"
ADD CONSTRAINT "analytics_events_benchmark_test_id_fkey"
FOREIGN KEY ("benchmark_test_id") REFERENCES "benchmark_tests"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

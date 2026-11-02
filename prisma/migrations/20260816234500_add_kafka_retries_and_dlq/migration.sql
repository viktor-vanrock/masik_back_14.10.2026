-- AlterTable
ALTER TABLE "recommendation_requests"
ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "next_retry_at" TIMESTAMPTZ(6);

-- CreateEnum
CREATE TYPE "KafkaProcessingFailureStatus" AS ENUM (
    'retrying',
    'resolved',
    'dead_lettered'
);

-- CreateTable
CREATE TABLE "kafka_processing_failures" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(249) NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" BIGINT NOT NULL,
    "message_key" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT NOT NULL,
    "status" "KafkaProcessingFailureStatus" NOT NULL DEFAULT 'retrying',
    "dead_letter_event_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "dead_lettered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "kafka_processing_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kafka_processing_failures_topic_partition_offset_key"
ON "kafka_processing_failures"("topic", "partition", "offset");

-- CreateIndex
CREATE UNIQUE INDEX "kafka_processing_failures_dead_letter_event_id_key"
ON "kafka_processing_failures"("dead_letter_event_id");

-- CreateIndex
CREATE INDEX "kafka_processing_failures_status_updated_at_idx"
ON "kafka_processing_failures"("status", "updated_at");

-- CreateIndex
CREATE INDEX "recommendation_requests_status_next_retry_at_idx"
ON "recommendation_requests"("status", "next_retry_at");

-- AlterTable
ALTER TABLE "recommendation_requests" ADD COLUMN     "result_payload" JSONB;

-- CreateTable
CREATE TABLE "inbox_messages" (
    "event_id" UUID NOT NULL,
    "topic" VARCHAR(249) NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" BIGINT NOT NULL,
    "event_type" VARCHAR(255) NOT NULL,
    "aggregate_type" VARCHAR(120) NOT NULL,
    "aggregate_id" VARCHAR(255) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "inbox_messages_aggregate_type_aggregate_id_idx" ON "inbox_messages"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_messages_topic_partition_offset_key" ON "inbox_messages"("topic", "partition", "offset");

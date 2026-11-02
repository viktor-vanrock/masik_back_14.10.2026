-- CreateEnum
CREATE TYPE "RecommendationRequestStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(249) NOT NULL,
    "message_key" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(255) NOT NULL,
    "aggregate_type" VARCHAR(120) NOT NULL,
    "aggregate_id" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_requests" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "top_k" INTEGER NOT NULL DEFAULT 1,
    "status" "RecommendationRequestStatus" NOT NULL DEFAULT 'pending',
    "retrieval_version" VARCHAR(500),
    "error_code" VARCHAR(120),
    "error_message" TEXT,
    "retryable" BOOLEAN,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recommendation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_messages_published_at_available_at_created_at_idx" ON "outbox_messages"("published_at", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_messages_aggregate_type_aggregate_id_idx" ON "outbox_messages"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "recommendation_requests_conversation_id_created_at_idx" ON "recommendation_requests"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "recommendation_requests_status_created_at_idx" ON "recommendation_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "recommendation_requests" ADD CONSTRAINT "recommendation_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

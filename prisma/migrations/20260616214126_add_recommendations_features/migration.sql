-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('pending', 'selected', 'rejected');

-- AlterEnum
ALTER TYPE "ConversationStatus" ADD VALUE 'awaiting_choice';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessageKind" ADD VALUE 'recommendation_selected';
ALTER TYPE "MessageKind" ADD VALUE 'recommendation_rejected';
ALTER TYPE "MessageKind" ADD VALUE 'result';

-- DropIndex
DROP INDEX "conversations_status_idx";

-- CreateTable
CREATE TABLE "recommendations" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "benchmark_id" VARCHAR(160) NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommendations_conversation_id_idx" ON "recommendations"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendations_conversation_id_benchmark_id_key" ON "recommendations"("conversation_id", "benchmark_id");

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "HypothesisGenerationStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "hypothesis_generations" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "benchmark_id" VARCHAR(160) NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "HypothesisGenerationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hypothesis_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hypotheses" (
    "id" UUID NOT NULL,
    "generation_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hypothesis_generations_conversation_id_idx" ON "hypothesis_generations"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "hypothesis_generations_conversation_id_attempt_number_key" ON "hypothesis_generations"("conversation_id", "attempt_number");

-- CreateIndex
CREATE INDEX "hypotheses_generation_id_idx" ON "hypotheses"("generation_id");

-- AddForeignKey
ALTER TABLE "hypothesis_generations" ADD CONSTRAINT "hypothesis_generations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "hypothesis_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

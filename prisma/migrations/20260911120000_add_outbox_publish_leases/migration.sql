ALTER TABLE "outbox_messages"
  ADD COLUMN "claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "claim_token" UUID;

DROP INDEX "outbox_messages_published_at_available_at_created_at_idx";

CREATE INDEX "outbox_messages_published_at_available_at_claimed_at_created_at_idx"
  ON "outbox_messages"("published_at", "available_at", "claimed_at", "created_at");

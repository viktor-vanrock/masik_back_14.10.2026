ALTER TABLE "outbox_messages"
ADD COLUMN "deduplication_key" VARCHAR(500);

CREATE UNIQUE INDEX "outbox_messages_deduplication_key_key"
ON "outbox_messages"("deduplication_key");

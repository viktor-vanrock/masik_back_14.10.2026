ALTER TABLE "catalog_entries"
ADD COLUMN "source_conversation_id" UUID;

CREATE UNIQUE INDEX "catalog_entries_source_conversation_id_key"
ON "catalog_entries"("source_conversation_id");

ALTER TABLE "catalog_entries"
ADD CONSTRAINT "catalog_entries_source_conversation_id_fkey"
FOREIGN KEY ("source_conversation_id")
REFERENCES "conversations"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

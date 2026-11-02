ALTER TABLE "conversations" ADD COLUMN "pinned_date" TIMESTAMPTZ(6);
UPDATE "conversations" SET "pinned_date" = "updated_at" WHERE "is_pinned" = true;
ALTER TABLE "conversations" DROP COLUMN "is_pinned";

ALTER TABLE "conversations"
  ADD COLUMN "title" VARCHAR(255),
  ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT false;

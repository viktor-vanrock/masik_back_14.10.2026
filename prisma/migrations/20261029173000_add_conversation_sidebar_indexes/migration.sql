CREATE INDEX "conversations_user_id_is_archived_pinned_date_idx"
ON "conversations"("user_id", "is_archived", "pinned_date" DESC);

CREATE INDEX "conversations_user_id_is_archived_updated_at_idx"
ON "conversations"("user_id", "is_archived", "updated_at" DESC);

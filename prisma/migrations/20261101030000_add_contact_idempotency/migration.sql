ALTER TABLE "contact_requests"
  ADD COLUMN "request_owner_id" VARCHAR(160),
  ADD COLUMN "idempotency_key" UUID,
  ADD COLUMN "request_hash" VARCHAR(64);

CREATE UNIQUE INDEX "contact_requests_request_owner_id_idempotency_key_key"
  ON "contact_requests"("request_owner_id", "idempotency_key");

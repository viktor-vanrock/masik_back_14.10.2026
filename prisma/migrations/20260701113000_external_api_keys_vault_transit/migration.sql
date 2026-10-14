-- Existing API keys contain bcrypt hashes. They cannot be converted to Vault
-- Transit HMAC values without the original raw keys, so they are revoked by
-- this migration and must be reissued after Vault Transit is configured.

-- CreateEnum
CREATE TYPE "ExternalApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- RenameColumn
ALTER TABLE "external_api_keys"
RENAME COLUMN "key_prefix" TO "prefix";

DROP INDEX "external_api_keys_key_prefix_idx";
DROP INDEX "external_api_keys_revoked_at_idx";

-- AlterTable
ALTER TABLE "external_api_keys"
ADD COLUMN "hmac" VARCHAR(512),
ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY['benchmark-tests:read']::TEXT[],
ADD COLUMN "status" "ExternalApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "owner" UUID;

UPDATE "external_api_keys"
SET
  "status" = 'REVOKED',
  "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP);

ALTER TABLE "external_api_keys"
DROP COLUMN "key_hash";

ALTER TABLE "external_api_keys"
ADD CONSTRAINT "external_api_keys_active_crypto_check"
CHECK (
  "status" <> 'ACTIVE'
  OR ("hmac" IS NOT NULL AND "owner" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "external_api_keys"
ADD CONSTRAINT "external_api_keys_owner_fkey"
FOREIGN KEY ("owner") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "external_api_keys_prefix_idx"
ON "external_api_keys"("prefix");

CREATE INDEX "external_api_keys_status_idx"
ON "external_api_keys"("status");

CREATE INDEX "external_api_keys_owner_idx"
ON "external_api_keys"("owner");

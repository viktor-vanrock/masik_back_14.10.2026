-- CreateTable
CREATE TABLE "external_api_keys" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "key_hash" VARCHAR(255) NOT NULL,
    "key_prefix" VARCHAR(32) NOT NULL,
    "description" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "external_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_api_keys_key_prefix_idx" ON "external_api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "external_api_keys_revoked_at_idx" ON "external_api_keys"("revoked_at");

-- CreateIndex
CREATE INDEX "external_api_keys_expires_at_idx" ON "external_api_keys"("expires_at");

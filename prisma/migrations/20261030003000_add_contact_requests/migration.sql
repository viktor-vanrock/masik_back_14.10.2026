CREATE TABLE "contact_requests" (
  "id" UUID NOT NULL,
  "public_number" VARCHAR(48) NOT NULL,
  "chat_id" UUID NOT NULL,
  "full_name" VARCHAR(100) NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "consent" BOOLEAN NOT NULL,
  "consent_at" TIMESTAMPTZ(6) NOT NULL,
  "consent_version" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contact_requests_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "contact_requests_consent_check" CHECK ("consent" = true)
);

CREATE UNIQUE INDEX "contact_requests_public_number_key" ON "contact_requests"("public_number");
CREATE INDEX "contact_requests_chat_id_idx" ON "contact_requests"("chat_id");

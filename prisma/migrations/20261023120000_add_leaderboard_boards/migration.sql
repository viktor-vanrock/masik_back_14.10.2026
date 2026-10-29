CREATE TABLE "leaderboard_boards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(240),
  "model_ids" VARCHAR(160)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(160)[],
  "benchmark_ids" VARCHAR(160)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(160)[],
  "architectures" VARCHAR(64)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(64)[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "leaderboard_boards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leaderboard_boards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "leaderboard_boards_user_id_idx" ON "leaderboard_boards"("user_id");

ALTER TABLE "leaderboard_boards" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "leaderboard_boards" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leaderboard_boards" ADD COLUMN "system_key" VARCHAR(64);

CREATE UNIQUE INDEX "leaderboard_boards_system_key_key" ON "leaderboard_boards"("system_key");

INSERT INTO "leaderboard_boards" ("name", "description", "is_public", "system_key", "model_ids", "benchmark_ids", "architectures", "updated_at")
VALUES
  ('Общий рейтинг', 'Базовые проверки качества и эффективности моделей.', true, 'general', ARRAY[]::VARCHAR(160)[], ARRAY[]::VARCHAR(160)[], ARRAY[]::VARCHAR(64)[], CURRENT_TIMESTAMP),
  ('Альтернативные архитектуры', 'Диффузионные модели, латентные ризонеры и другие архитектуры.', true, 'alternative-architectures', ARRAY[]::VARCHAR(160)[], ARRAY[]::VARCHAR(160)[], ARRAY['ar-transformer', 'text-diffusion', 'latent-reasoner', 'colloquium', 'omnimodal']::VARCHAR(64)[], CURRENT_TIMESTAMP),
  ('Агентные системы', 'Модели и оболочки для задач с инструментами.', true, 'agent-systems', ARRAY[]::VARCHAR(160)[], ARRAY[]::VARCHAR(160)[], ARRAY[]::VARCHAR(64)[], CURRENT_TIMESTAMP)
ON CONFLICT ("system_key") DO NOTHING;

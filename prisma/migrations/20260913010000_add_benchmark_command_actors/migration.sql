CREATE TABLE "benchmark_command_actors" (
    "command_event_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_command_actors_pkey" PRIMARY KEY ("command_event_id")
);

CREATE INDEX "benchmark_command_actors_actor_id_created_at_idx"
  ON "benchmark_command_actors"("actor_id", "created_at");

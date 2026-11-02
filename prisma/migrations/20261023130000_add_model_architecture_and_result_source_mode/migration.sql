ALTER TABLE "models" ADD COLUMN "architecture" VARCHAR(64);
ALTER TABLE "metric_results" ADD COLUMN "source_mode" VARCHAR(32) NOT NULL DEFAULT 'benchmark';

CREATE INDEX "models_architecture_idx" ON "models"("architecture");
CREATE INDEX "metric_results_source_mode_idx" ON "metric_results"("source_mode");

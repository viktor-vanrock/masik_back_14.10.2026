-- Evaluation logic and required model quality are Test configuration. Refuse
-- to discard a legacy value that has not yet been reconciled with its Test.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "metric_definitions"
    WHERE "evaluation_logic" IS NOT NULL
       OR "required_gigachat_quality_level" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot remove Test-owned Metric fields: legacy MetricDefinition values still contain data';
  END IF;
END $$;

ALTER TABLE "metric_definitions"
  DROP COLUMN "evaluation_logic",
  DROP COLUMN "required_gigachat_quality_level";

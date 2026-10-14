-- Catalog owns moderation lifecycle while benchmark-service owns Test.
-- Keep the stable external Test identifier, but remove the physical FK so a
-- CatalogEntry can exist while the Test projection is delayed or legacy Test
-- rows are removed during cutover.
ALTER TABLE "catalog_entries"
  DROP CONSTRAINT IF EXISTS "catalog_entries_test_id_fkey";

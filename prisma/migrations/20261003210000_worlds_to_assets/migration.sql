-- Migrate the legacy `worlds` / `world_assets` tables into the generic asset
-- tables (`assets` / `asset_releases` / `asset_files`) as the `world` asset type.
--
--   world            -> asset  (type = 'world', provider = 'upload')
--   world_asset rows -> one release per (world, version) + one file per row
--   world.capacity   -> asset.metadata.capacity
--   world.thumbnail  -> asset.images[0].key
--   world.release    -> asset.release (the version, which is also the release id)
--
-- The legacy tables are dropped at the end, once the data has been copied.

-- Assets ----------------------------------------------------------------------
INSERT INTO "assets" (
  "id", "type", "provider", "name", "title", "description", "tags",
  "owner_ref", "contributor_refs", "metadata", "images", "release",
  "created_at", "updated_at"
)
SELECT
  w."id",
  'world',
  'upload',
  w."name",
  w."title",
  w."description",
  w."tags",
  w."owner_ref",
  w."contributor_refs",
  jsonb_build_object('capacity', w."capacity"),
  CASE
    WHEN w."thumbnail" IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('key', w."thumbnail"))
  END,
  NULL,
  w."created_at",
  w."updated_at"
FROM "worlds" w
ON CONFLICT ("type", "id") DO NOTHING;

-- Releases: one per (world, version), the version doubles as the release id --
INSERT INTO "asset_releases" (
  "id", "asset_type", "asset_id", "name", "title", "changelog", "channel",
  "metadata", "created_at", "updated_at"
)
SELECT
  wa."version",
  'world',
  wa."world_id",
  'v' || wa."version"::text,
  'Version ' || wa."version"::text,
  NULL,
  'stable'::"asset_release_channel",
  CASE
    WHEN bool_or(wa."url" IS NOT NULL) THEN
      jsonb_build_object('status', jsonb_build_object('status', 'completed', 'progress', 100, 'message', NULL))
    ELSE
      jsonb_build_object('status', jsonb_build_object('status', 'queued', 'progress', 0, 'message', 'Awaiting upload stream'))
  END,
  MIN(wa."created_at"),
  MAX(wa."updated_at")
FROM "world_assets" wa
WHERE EXISTS (
  SELECT 1 FROM "assets" a WHERE a."type" = 'world' AND a."id" = wa."world_id"
)
GROUP BY wa."world_id", wa."version"
ON CONFLICT DO NOTHING;

-- Files: one per (world, version, engine, platform) ---------------------------
INSERT INTO "asset_files" (
  "release_asset_type", "release_asset_id", "release_id",
  "name", "url", "size", "mime", "attributes", "hashes",
  "uploader_ref", "metadata", "created_at", "updated_at"
)
SELECT
  'world',
  wa."world_id",
  r."id",
  wa."engine" || '-' || wa."platform",
  COALESCE(wa."url", ''),
  COALESCE(wa."size", 0)::bigint,
  'application/octet-stream',
  jsonb_build_array(
    jsonb_build_object('key', 'engine', 'value', wa."engine"),
    jsonb_build_object('key', 'platform', 'value', wa."platform")
  ),
  CASE
    WHEN wa."hash" IS NULL THEN ARRAY[]::text[]
    ELSE ARRAY['sha256:' || wa."hash"]
  END,
  wa."uploader_ref",
  jsonb_build_object(
    'status',
    CASE
      WHEN wa."url" IS NOT NULL THEN
        jsonb_build_object('status', 'completed', 'progress', 100, 'message', NULL)
      ELSE
        jsonb_build_object('status', 'queued', 'progress', 0, 'message', 'Awaiting upload stream')
    END,
    'features', to_jsonb(wa."features"),
    'modRefs', to_jsonb(wa."mod_refs")
  ),
  wa."created_at",
  wa."updated_at"
FROM "world_assets" wa
JOIN "asset_releases" r
  ON r."asset_type" = 'world'
 AND r."asset_id" = wa."world_id"
 AND r."id" = wa."version"
WHERE EXISTS (
  SELECT 1 FROM "assets" a WHERE a."type" = 'world' AND a."id" = wa."world_id"
)
ON CONFLICT ("release_asset_type", "release_asset_id", "release_id", "name") DO NOTHING;

-- Preferred release: `worlds.release` holds the version, which is the id -----
UPDATE "assets" a
SET "release" = w."release"
FROM "worlds" w
WHERE a."type" = 'world'
  AND a."id" = w."id"
  AND w."release" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "asset_releases" r
    WHERE r."asset_type" = 'world'
      AND r."asset_id" = w."id"
      AND r."id" = w."release"
  );

-- Keep the shared `assets` id sequence ahead of the explicitly imported ids ---
SELECT setval(
  pg_get_serial_sequence('assets', 'id'),
  GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "assets"), 1),
  true
);

-- World releases use the version (0-65535) as id: push the shared sequence
-- above that range so an auto-generated id can never collide with a version.
SELECT setval(
  pg_get_serial_sequence('asset_releases', 'id'),
  GREATEST((SELECT COALESCE(MAX("id"), 0) FROM "asset_releases"), 65535),
  true
);

-- Drop the legacy tables (their data has been copied above) -------------------
DROP TABLE "world_assets";
DROP TABLE "worlds";

-- Migrate the legacy `avatars` / `avatar_assets` tables into the generic asset
-- tables (`assets` / `asset_releases` / `asset_files`) as the `avatar` asset type.
--
--   avatar            -> asset  (type = 'avatar', provider = 'upload')
--   avatar_asset rows -> one release per (avatar, version) + one file per row
--   avatar.thumbnail  -> asset.images[0].key
--   avatar.release    -> asset.release (the version, which is also the release id)
--
-- The legacy tables are dropped at the end, once the data has been copied.

-- Assets ----------------------------------------------------------------------
INSERT INTO "assets" (
  "id", "type", "provider", "name", "title", "description", "tags",
  "owner_ref", "contributor_refs", "metadata", "images", "release",
  "created_at", "updated_at"
)
SELECT
  a."id",
  'avatar',
  'upload',
  a."name",
  a."title",
  a."description",
  a."tags",
  a."owner_ref",
  a."contributor_refs",
  '{}'::jsonb,
  CASE
    WHEN a."thumbnail" IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('key', a."thumbnail"))
  END,
  NULL,
  a."created_at",
  a."updated_at"
FROM "avatars" a
ON CONFLICT ("type", "id") DO NOTHING;

-- Releases: one per (avatar, version), the version doubles as the release id --
INSERT INTO "asset_releases" (
  "id", "asset_type", "asset_id", "name", "title", "changelog", "channel",
  "metadata", "created_at", "updated_at"
)
SELECT
  aa."version",
  'avatar',
  aa."avatar_id",
  'v' || aa."version"::text,
  'Version ' || aa."version"::text,
  NULL,
  'stable'::"asset_release_channel",
  CASE
    WHEN bool_or(aa."url" IS NOT NULL) THEN
      jsonb_build_object('status', jsonb_build_object('status', 'completed', 'progress', 100, 'message', NULL))
    ELSE
      jsonb_build_object('status', jsonb_build_object('status', 'queued', 'progress', 0, 'message', 'Awaiting upload stream'))
  END,
  MIN(aa."created_at"),
  MAX(aa."updated_at")
FROM "avatar_assets" aa
WHERE EXISTS (
  SELECT 1 FROM "assets" x WHERE x."type" = 'avatar' AND x."id" = aa."avatar_id"
)
GROUP BY aa."avatar_id", aa."version"
ON CONFLICT DO NOTHING;

-- Files: one per (avatar, version, engine, platform) --------------------------
INSERT INTO "asset_files" (
  "release_asset_type", "release_asset_id", "release_id",
  "name", "url", "size", "mime", "attributes", "hashes",
  "uploader_ref", "metadata", "created_at", "updated_at"
)
SELECT
  'avatar',
  aa."avatar_id",
  r."id",
  aa."engine" || '-' || aa."platform",
  COALESCE(aa."url", ''),
  COALESCE(aa."size", 0)::bigint,
  'application/octet-stream',
  jsonb_build_array(
    jsonb_build_object('key', 'engine', 'value', aa."engine"),
    jsonb_build_object('key', 'platform', 'value', aa."platform")
  ),
  CASE
    WHEN aa."hash" IS NULL THEN ARRAY[]::text[]
    ELSE ARRAY['sha256:' || aa."hash"]
  END,
  aa."uploader_ref",
  jsonb_build_object(
    'status',
    CASE
      WHEN aa."url" IS NOT NULL THEN
        jsonb_build_object('status', 'completed', 'progress', 100, 'message', NULL)
      ELSE
        jsonb_build_object('status', 'queued', 'progress', 0, 'message', 'Awaiting upload stream')
    END,
    'features', to_jsonb(aa."features")
  ),
  aa."created_at",
  aa."updated_at"
FROM "avatar_assets" aa
JOIN "asset_releases" r
  ON r."asset_type" = 'avatar'
 AND r."asset_id" = aa."avatar_id"
 AND r."id" = aa."version"
WHERE EXISTS (
  SELECT 1 FROM "assets" x WHERE x."type" = 'avatar' AND x."id" = aa."avatar_id"
)
ON CONFLICT ("release_asset_type", "release_asset_id", "release_id", "name") DO NOTHING;

-- Preferred release: `avatars.release` holds the version, which is the id ----
UPDATE "assets" a
SET "release" = v."release"
FROM "avatars" v
WHERE a."type" = 'avatar'
  AND a."id" = v."id"
  AND v."release" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "asset_releases" r
    WHERE r."asset_type" = 'avatar'
      AND r."asset_id" = v."id"
      AND r."id" = v."release"
  );

-- Keep the shared `assets` id sequence ahead of the explicitly imported ids ---
SELECT setval(
  pg_get_serial_sequence('assets', 'id'),
  GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "assets"), 1),
  true
);

-- Drop the legacy tables (their data has been copied above) -------------------
DROP TABLE "avatar_assets";
DROP TABLE "avatars";

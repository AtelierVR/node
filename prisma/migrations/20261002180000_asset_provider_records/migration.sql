-- Preserve provider-specific columns and aliases before narrowing the SQL models.
UPDATE "assets" AS asset
SET "metadata" =
    (CASE
      WHEN jsonb_typeof(asset."metadata") = 'object' THEN asset."metadata"
      ELSE '{}'::jsonb
    END)
    || jsonb_build_object(
      'providerData',
      jsonb_build_object(
        'externalId', asset."external_id",
        'publicId', asset."public_id",
        'server', asset."server",
        'sourceCreatedAt', asset."source_created_at",
        'sourceUpdatedAt', asset."source_updated_at",
        'syncedAt', asset."synced_at",
        'releasesSyncedAt', asset."releases_synced_at"
      ),
      'aliases',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('key', alias."key", 'value', alias."value")
            ORDER BY alias."id"
          )
          FROM "asset_aliases" AS alias
          WHERE alias."asset_id" = asset."id"
        ),
        '[]'::jsonb
      )
    );

UPDATE "asset_releases"
SET "metadata" =
    (CASE
      WHEN jsonb_typeof("metadata") = 'object' THEN "metadata"
      ELSE '{}'::jsonb
    END)
    || jsonb_build_object(
      'providerData',
      jsonb_build_object(
        'externalId', "external_id",
        'publicId', "public_id",
        'sourceUrl', "source_url",
        'publishedAt', "published_at",
        'prerelease', "prerelease",
        'isLatest', "is_latest",
        'syncedAt', "synced_at"
      )
    );

ALTER TABLE "asset_files"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "asset_files"
SET "metadata" =
    (CASE
      WHEN "metadata" IS NOT NULL AND jsonb_typeof("metadata") = 'object'
        THEN "metadata"
      ELSE '{}'::jsonb
    END)
    || jsonb_build_object('providerData', jsonb_build_object('syncedAt', "synced_at"));

ALTER TABLE "assets"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "asset_releases"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "asset_files"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "assets"
  ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

ALTER TABLE "asset_releases"
  ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

DROP INDEX "assets_type_name_idx";
DROP INDEX "assets_synced_at_idx";
DROP INDEX "assets_provider_type_external_id_key";
DROP INDEX "assets_type_public_id_key";
DROP INDEX "asset_aliases_key_value_idx";
DROP INDEX "asset_aliases_asset_id_key_value_key";
DROP INDEX "asset_releases_asset_id_published_at_idx";
DROP INDEX "asset_releases_asset_id_external_id_key";

DROP TABLE "asset_aliases";

ALTER TABLE "assets"
  DROP COLUMN "external_id",
  DROP COLUMN "public_id",
  DROP COLUMN "icon_url",
  DROP COLUMN "server",
  DROP COLUMN "source_created_at",
  DROP COLUMN "source_updated_at",
  DROP COLUMN "synced_at",
  DROP COLUMN "releases_synced_at";

ALTER TABLE "asset_releases"
  DROP COLUMN "external_id",
  DROP COLUMN "public_id",
  DROP COLUMN "source_url",
  DROP COLUMN "published_at",
  DROP COLUMN "prerelease",
  DROP COLUMN "is_latest",
  DROP COLUMN "synced_at";

ALTER TABLE "asset_files"
  DROP COLUMN "synced_at";

CREATE UNIQUE INDEX "assets_type_provider_name_key"
  ON "assets"("type", "provider", "name");

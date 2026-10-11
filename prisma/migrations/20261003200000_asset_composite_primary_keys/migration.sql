-- Composite primary keys for assets / asset_releases, and the widened
-- asset_files -> asset_releases foreign key.
--
-- The new NOT NULL columns are added nullable first so existing rows can be
-- backfilled from their parent rows before the constraint is enforced.

-- AssetRelease.asset_type -----------------------------------------------------
ALTER TABLE "asset_releases" ADD COLUMN "asset_type" TEXT;

UPDATE "asset_releases" r
SET "asset_type" = a."type"
FROM "assets" a
WHERE r."asset_id" = a."id";

ALTER TABLE "asset_releases" ALTER COLUMN "asset_type" SET NOT NULL;

-- AssetFile composite release reference ---------------------------------------
ALTER TABLE "asset_files" ADD COLUMN "release_asset_type" TEXT;
ALTER TABLE "asset_files" ADD COLUMN "release_asset_id" INTEGER;

UPDATE "asset_files" f
SET "release_asset_type" = r."asset_type",
    "release_asset_id"   = r."asset_id"
FROM "asset_releases" r
WHERE f."release_id" = r."id";

ALTER TABLE "asset_files" ALTER COLUMN "release_asset_type" SET NOT NULL;
ALTER TABLE "asset_files" ALTER COLUMN "release_asset_id" SET NOT NULL;

-- Drop the old foreign keys / unique indexes ----------------------------------
ALTER TABLE "asset_files" DROP CONSTRAINT "asset_files_release_id_fkey";
ALTER TABLE "asset_releases" DROP CONSTRAINT "asset_releases_asset_id_fkey";
DROP INDEX "asset_files_release_id_name_key";
DROP INDEX "asset_releases_asset_id_name_key";

-- Swap the primary keys -------------------------------------------------------
ALTER TABLE "assets" DROP CONSTRAINT "assets_pkey";
ALTER TABLE "assets" ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("type", "id");

ALTER TABLE "asset_releases" DROP CONSTRAINT "asset_releases_pkey";
ALTER TABLE "asset_releases" ADD CONSTRAINT "asset_releases_pkey" PRIMARY KEY ("asset_type", "asset_id", "id");

-- New unique indexes ----------------------------------------------------------
CREATE UNIQUE INDEX "asset_releases_asset_type_asset_id_name_key" ON "asset_releases"("asset_type", "asset_id", "name");
CREATE UNIQUE INDEX "asset_files_release_asset_type_release_asset_id_release_id__key" ON "asset_files"("release_asset_type", "release_asset_id", "release_id", "name");

-- New foreign keys ------------------------------------------------------------
ALTER TABLE "asset_releases" ADD CONSTRAINT "asset_releases_asset_type_asset_id_fkey" FOREIGN KEY ("asset_type", "asset_id") REFERENCES "assets"("type", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_release_asset_type_release_asset_id_release_id_fkey" FOREIGN KEY ("release_asset_type", "release_asset_id", "release_id") REFERENCES "asset_releases"("asset_type", "asset_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

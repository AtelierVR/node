CREATE TYPE "asset_release_channel_new" AS ENUM ('stable', 'candidate', 'nightly');

ALTER TABLE "asset_releases"
ALTER COLUMN "channel" TYPE "asset_release_channel_new"
USING (
  CASE "channel"::text
    WHEN 'alpha' THEN 'candidate'
    WHEN 'beta' THEN 'candidate'
    ELSE "channel"::text
  END
)::"asset_release_channel_new";

DROP TYPE "asset_release_channel";

ALTER TYPE "asset_release_channel_new" RENAME TO "asset_release_channel";

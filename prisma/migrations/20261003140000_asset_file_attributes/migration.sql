-- AlterTable
ALTER TABLE "asset_files" DROP COLUMN "tags",
ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '[]';

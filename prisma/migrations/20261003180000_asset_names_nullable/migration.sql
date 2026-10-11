-- Align the database with the Prisma schema: a release name and a file name are
-- optional (an unnamed release/file is addressed by its numeric id, and only a
-- named one can be looked up by name).
ALTER TABLE "asset_releases" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "asset_files" ALTER COLUMN "name" DROP NOT NULL;

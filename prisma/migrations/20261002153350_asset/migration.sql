-- CreateEnum
CREATE TYPE "asset_release_channel" AS ENUM ('alpha', 'beta', 'stable');

-- CreateTable
CREATE TABLE "assets" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "public_id" INTEGER NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "description" TEXT,
    "icon_url" TEXT,
    "server" TEXT NOT NULL,
    "owner_ref" TEXT NOT NULL,
    "contributor_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL,
    "source_created_at" TIMESTAMP(3) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releases_synced_at" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_aliases" (
    "id" SERIAL NOT NULL,
    "asset_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "asset_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_releases" (
    "id" SERIAL NOT NULL,
    "asset_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "public_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "changelog" TEXT,
    "channel" "asset_release_channel" NOT NULL,
    "source_url" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "prerelease" BOOLEAN NOT NULL DEFAULT false,
    "is_latest" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_files" (
    "id" SERIAL NOT NULL,
    "release_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mime" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploader_ref" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_type_name_idx" ON "assets"("type", "name");

-- CreateIndex
CREATE INDEX "assets_synced_at_idx" ON "assets"("synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "assets_provider_type_external_id_key" ON "assets"("provider", "type", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_type_public_id_key" ON "assets"("type", "public_id");

-- CreateIndex
CREATE INDEX "asset_aliases_key_value_idx" ON "asset_aliases"("key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "asset_aliases_asset_id_key_value_key" ON "asset_aliases"("asset_id", "key", "value");

-- CreateIndex
CREATE INDEX "asset_releases_asset_id_published_at_idx" ON "asset_releases"("asset_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "asset_releases_asset_id_external_id_key" ON "asset_releases"("asset_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_releases_asset_id_name_key" ON "asset_releases"("asset_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "asset_files_release_id_name_key" ON "asset_files"("release_id", "name");

-- AddForeignKey
ALTER TABLE "asset_aliases" ADD CONSTRAINT "asset_aliases_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_releases" ADD CONSTRAINT "asset_releases_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "asset_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

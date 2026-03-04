-- CreateTable
CREATE TABLE "Avatar" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "tags" TEXT[],
    "owner_ref" TEXT NOT NULL,
    "contributor_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarAsset" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "engine" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT,
    "hash" TEXT,
    "mod_refs" TEXT[],
    "features" TEXT[],
    "size" INTEGER,
    "avatar_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvatarAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvatarAsset_version_engine_platform_avatar_id_idx" ON "AvatarAsset"("version", "engine", "platform", "avatar_id");

-- AddForeignKey
ALTER TABLE "AvatarAsset" ADD CONSTRAINT "AvatarAsset_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Avatar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

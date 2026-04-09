-- CreateEnum
CREATE TYPE "presence_status" AS ENUM ('ONLINE', 'BUSY', 'DO_NOT_DISTURB', 'STREAM', 'OFFLINE');

-- CreateEnum
CREATE TYPE "user_relation_type" AS ENUM ('FOLLOW', 'REQUEST');

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "public_key" BYTEA,
    "fingerprint" TEXT,
    "expires" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "session_id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "bio" TEXT,
    "pronoun" TEXT,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "password" TEXT,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "thumbnail" TEXT,
    "banner" TEXT,
    "links" JSONB NOT NULL DEFAULT '[]',
    "blacklisted" JSONB,
    "home_ref" TEXT,
    "avatar_ref" TEXT,
    "twofa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "twofa_secret" TEXT,
    "presence" "presence_status" NOT NULL DEFAULT 'ONLINE',
    "presence_status" TEXT,
    "public" BYTEA NOT NULL,
    "private" BYTEA NOT NULL,
    "expires_keys" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_relations" (
    "id" TEXT NOT NULL,
    "type" "user_relation_type" NOT NULL,
    "initiator_ref" TEXT NOT NULL,
    "target_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tables" (
    "key" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "value" BYTEA NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tables_pkey" PRIMARY KEY ("key","user_id")
);

-- CreateTable
CREATE TABLE "configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "verification_factors" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_servers" (
    "id" SERIAL NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "address" TEXT NOT NULL,
    "public" BYTEA NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_users" (
    "id" INTEGER NOT NULL,
    "public" BYTEA NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "blacklisted" JSONB,
    "server_id" INTEGER NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_users_pkey" PRIMARY KEY ("id","server_id")
);

-- CreateTable
CREATE TABLE "avatars" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "tags" TEXT[],
    "owner_ref" TEXT NOT NULL,
    "release" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_assets" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "engine" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT,
    "hash" TEXT,
    "size" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avatar_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worlds" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "tags" TEXT[],
    "capacity" INTEGER NOT NULL,
    "owner_ref" TEXT NOT NULL,
    "contributor_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "release" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_assets" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "engine" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT,
    "hash" TEXT,
    "size" INTEGER,
    "mod_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploader_ref" TEXT,
    "world_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "author_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "devices_session_id_ip_user_agent_key" ON "devices"("session_id", "ip", "user_agent");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_relations_initiator_ref_target_ref_key" ON "user_relations"("initiator_ref", "target_ref");

-- CreateIndex
CREATE UNIQUE INDEX "external_servers_address_key" ON "external_servers"("address");

-- CreateIndex
CREATE UNIQUE INDEX "external_servers_public_key" ON "external_servers"("public");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_assets_avatar_id_version_engine_platform_key" ON "avatar_assets"("avatar_id", "version", "engine", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "world_assets_world_id_version_engine_platform_key" ON "world_assets"("world_id", "version", "engine", "platform");

-- CreateIndex
CREATE INDEX "activity_events_type_idx" ON "activity_events"("type");

-- CreateIndex
CREATE INDEX "activity_events_created_at_idx" ON "activity_events"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tables" ADD CONSTRAINT "user_tables_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_factors" ADD CONSTRAINT "verification_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_users" ADD CONSTRAINT "external_users_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "external_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatar_assets" ADD CONSTRAINT "avatar_assets_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_assets" ADD CONSTRAINT "world_assets_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

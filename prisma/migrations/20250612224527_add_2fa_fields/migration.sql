-- CreateEnum
CREATE TYPE "UserRelationType" AS ENUM ('REQUEST', 'REQUESTED_BY', 'FOLLOW', 'FOLLOWED_BY');

-- CreateEnum
CREATE TYPE "NotificationDeletion" AS ENUM ('IMMEDIATE', 'ON_READ', 'ON_EXPIRE');

-- CreateTable
CREATE TABLE "NetServer" (
    "id" SERIAL NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "address" TEXT NOT NULL,
    "public" TEXT NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" SERIAL NOT NULL,
    "out_token" TEXT,
    "in_token" TEXT,
    "server_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetUser" (
    "id" INTEGER NOT NULL,
    "server_id" INTEGER NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blacklisted" JSONB,
    "tags" TEXT[],
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetUser_pkey" PRIMARY KEY ("id","server_id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "links" TEXT[],
    "thumbnail" TEXT,
    "bio" TEXT,
    "banner" TEXT,
    "email" TEXT,
    "password" TEXT,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blacklisted" JSONB,
    "home_ref" TEXT,
    "tags" TEXT[],
    "twofa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "twofa_secret" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutIntegrity" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "server_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutIntegrity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InIntegrity" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "server_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InIntegrity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRelation" (
    "id" TEXT NOT NULL,
    "type" "UserRelationType" NOT NULL,
    "initiator_ref" TEXT NOT NULL,
    "target_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instance" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "thumbnail" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "world_ref" TEXT NOT NULL,
    "owner_ref" TEXT NOT NULL,
    "use_whitelist" BOOLEAN NOT NULL DEFAULT false,
    "whitelist_refs" TEXT[],
    "use_password" BOOLEAN NOT NULL DEFAULT false,
    "password" TEXT,
    "cache" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" SERIAL NOT NULL,
    "session_id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badger" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "relay_id" INTEGER NOT NULL,

    CONSTRAINT "Badger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relay" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "max_instances" INTEGER NOT NULL DEFAULT 0,
    "use_address" TEXT,

    CONSTRAINT "Relay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "World" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "tags" TEXT[],
    "capacity" INTEGER NOT NULL,
    "owner_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldAsset" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "engine" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT,
    "hash" TEXT,
    "mod_refs" TEXT[],
    "features" TEXT[],
    "size" INTEGER,
    "world_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayInstance" (
    "id" SERIAL NOT NULL,
    "relay_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelayInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "to_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presence" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NetServer_address_key" ON "NetServer"("address");

-- CreateIndex
CREATE UNIQUE INDEX "NetServer_public_key" ON "NetServer"("public");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_out_token_key" ON "Challenge"("out_token");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OutIntegrity_token_key" ON "OutIntegrity"("token");

-- CreateIndex
CREATE UNIQUE INDEX "InIntegrity_token_key" ON "InIntegrity"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_name_key" ON "Instance"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Device_session_id_ip_user_agent_key" ON "Device"("session_id", "ip", "user_agent");

-- CreateIndex
CREATE UNIQUE INDEX "Badger_token_key" ON "Badger"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Badger_relay_id_key" ON "Badger"("relay_id");

-- CreateIndex
CREATE INDEX "WorldAsset_version_engine_platform_world_id_idx" ON "WorldAsset"("version", "engine", "platform", "world_id");

-- CreateIndex
CREATE UNIQUE INDEX "RelayInstance_instance_id_key" ON "RelayInstance"("instance_id");

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "NetServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetUser" ADD CONSTRAINT "NetUser_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "NetServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutIntegrity" ADD CONSTRAINT "OutIntegrity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutIntegrity" ADD CONSTRAINT "OutIntegrity_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "NetServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InIntegrity" ADD CONSTRAINT "InIntegrity_user_id_server_id_fkey" FOREIGN KEY ("user_id", "server_id") REFERENCES "NetUser"("id", "server_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InIntegrity" ADD CONSTRAINT "InIntegrity_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "NetServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badger" ADD CONSTRAINT "Badger_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "Relay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldAsset" ADD CONSTRAINT "WorldAsset_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelayInstance" ADD CONSTRAINT "RelayInstance_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "Relay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelayInstance" ADD CONSTRAINT "RelayInstance_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "Instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

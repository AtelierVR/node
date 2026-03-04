/*
  Warnings:

  - You are about to drop the `InIntegrity` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OutIntegrity` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `links` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE_ALL_JOIN', 'ONLINE_JOIN', 'ONLINE', 'BUSY', 'DO_NOT_DISTURB', 'STREAM', 'OFFLINE');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENDING', 'SENT', 'DELIVERED', 'FAILED', 'RETRYING');

-- DropForeignKey
ALTER TABLE "AvatarAsset" DROP CONSTRAINT "AvatarAsset_avatar_id_fkey";

-- DropForeignKey
ALTER TABLE "InIntegrity" DROP CONSTRAINT "InIntegrity_server_id_fkey";

-- DropForeignKey
ALTER TABLE "InIntegrity" DROP CONSTRAINT "InIntegrity_user_id_server_id_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_to_user_id_fkey";

-- DropForeignKey
ALTER TABLE "OutIntegrity" DROP CONSTRAINT "OutIntegrity_server_id_fkey";

-- DropForeignKey
ALTER TABLE "OutIntegrity" DROP CONSTRAINT "OutIntegrity_user_id_fkey";

-- DropForeignKey
ALTER TABLE "Presence" DROP CONSTRAINT "Presence_user_id_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_user_id_fkey";

-- DropForeignKey
ALTER TABLE "WorldAsset" DROP CONSTRAINT "WorldAsset_world_id_fkey";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "external_id" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "presence" "PresenceStatus" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "presence_status" TEXT,
ADD COLUMN     "pronoun" TEXT,
ALTER COLUMN "links" SET NOT NULL;

-- DropTable
DROP TABLE "InIntegrity";

-- DropTable
DROP TABLE "OutIntegrity";

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "avatar" TEXT,
    "authority_server" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_message" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationReference" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "authority_server" TEXT NOT NULL,
    "user_ref" TEXT NOT NULL,
    "title" TEXT,
    "avatar" TEXT,
    "last_message_at" TIMESTAMP(3),
    "last_fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_ref" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),
    "notification_mode" TEXT NOT NULL DEFAULT 'ALL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_ref" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "reply_to_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "delivery_errors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "edited_at" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_authority_server_idx" ON "Conversation"("authority_server");

-- CreateIndex
CREATE INDEX "ConversationReference_user_ref_idx" ON "ConversationReference"("user_ref");

-- CreateIndex
CREATE INDEX "ConversationReference_authority_server_idx" ON "ConversationReference"("authority_server");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReference_conversation_id_authority_server_user_key" ON "ConversationReference"("conversation_id", "authority_server", "user_ref");

-- CreateIndex
CREATE INDEX "ConversationMember_user_ref_idx" ON "ConversationMember"("user_ref");

-- CreateIndex
CREATE INDEX "ConversationMember_conversation_id_last_read_at_idx" ON "ConversationMember"("conversation_id", "last_read_at");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversation_id_user_ref_key" ON "ConversationMember"("conversation_id", "user_ref");

-- CreateIndex
CREATE INDEX "Message_conversation_id_created_at_idx" ON "Message"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "Message_sender_ref_idx" ON "Message"("sender_ref");

-- CreateIndex
CREATE INDEX "Message_status_retry_count_idx" ON "Message"("status", "retry_count");

-- CreateIndex
CREATE INDEX "AvatarAsset_hash_idx" ON "AvatarAsset"("hash");

-- CreateIndex
CREATE INDEX "Notification_external_id_idx" ON "Notification"("external_id");

-- CreateIndex
CREATE INDEX "Notification_expires_at_idx" ON "Notification"("expires_at");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarAsset" ADD CONSTRAINT "AvatarAsset_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Avatar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldAsset" ADD CONSTRAINT "WorldAsset_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

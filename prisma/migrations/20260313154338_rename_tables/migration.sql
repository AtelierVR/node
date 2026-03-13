-- Rename PascalCase tables to snake_case, preserve all data.
-- Only ConversationReference is dropped+recreated (structure changed completely).
-- MessageDeliveryQueue is dropped (removed from schema).
-- =====================
-- RENAME TABLES
-- =====================
ALTER TABLE "NetServer" RENAME TO "net_servers";
ALTER TABLE "NetUser" RENAME TO "net_users";
ALTER TABLE "User" RENAME TO "users";
ALTER TABLE "EmailVerification" RENAME TO "email_verifications";
ALTER TABLE "VerificationFactor" RENAME TO "verification_factors";
ALTER TABLE "UserRelation" RENAME TO "user_relations";
ALTER TABLE "Instance" RENAME TO "instances";
ALTER TABLE "Session" RENAME TO "sessions";
ALTER TABLE "Device" RENAME TO "devices";
ALTER TABLE "Badger" RENAME TO "badgers";
ALTER TABLE "Relay" RENAME TO "relays";
ALTER TABLE "Avatar" RENAME TO "avatars";
ALTER TABLE "AvatarAsset" RENAME TO "avatar_assets";
ALTER TABLE "World" RENAME TO "worlds";
ALTER TABLE "WorldAsset" RENAME TO "world_assets";
ALTER TABLE "Notification" RENAME TO "notifications";
ALTER TABLE "Presence" RENAME TO "presences";
ALTER TABLE "Table" RENAME TO "tables";
ALTER TABLE "Conversation" RENAME TO "conversations";
ALTER TABLE "ConversationMember" RENAME TO "conversation_members";
ALTER TABLE "Message" RENAME TO "messages";

-- =====================
-- RENAME PRIMARY KEY CONSTRAINTS
-- =====================
ALTER TABLE "net_servers" RENAME CONSTRAINT "NetServer_pkey" TO "net_servers_pkey";
ALTER TABLE "net_users" RENAME CONSTRAINT "NetUser_pkey" TO "net_users_pkey";
ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";
ALTER TABLE "email_verifications" RENAME CONSTRAINT "EmailVerification_pkey" TO "email_verifications_pkey";
ALTER TABLE "verification_factors" RENAME CONSTRAINT "VerificationFactor_pkey" TO "verification_factors_pkey";
ALTER TABLE "user_relations" RENAME CONSTRAINT "UserRelation_pkey" TO "user_relations_pkey";
ALTER TABLE "instances" RENAME CONSTRAINT "Instance_pkey" TO "instances_pkey";
ALTER TABLE "sessions" RENAME CONSTRAINT "Session_pkey" TO "sessions_pkey";
ALTER TABLE "devices" RENAME CONSTRAINT "Device_pkey" TO "devices_pkey";
ALTER TABLE "badgers" RENAME CONSTRAINT "Badger_pkey" TO "badgers_pkey";
ALTER TABLE "relays" RENAME CONSTRAINT "Relay_pkey" TO "relays_pkey";
ALTER TABLE "avatars" RENAME CONSTRAINT "Avatar_pkey" TO "avatars_pkey";
ALTER TABLE "avatar_assets" RENAME CONSTRAINT "AvatarAsset_pkey" TO "avatar_assets_pkey";
ALTER TABLE "worlds" RENAME CONSTRAINT "World_pkey" TO "worlds_pkey";
ALTER TABLE "world_assets" RENAME CONSTRAINT "WorldAsset_pkey" TO "world_assets_pkey";
ALTER TABLE "notifications" RENAME CONSTRAINT "Notification_pkey" TO "notifications_pkey";
ALTER TABLE "presences" RENAME CONSTRAINT "Presence_pkey" TO "presences_pkey";
ALTER TABLE "tables" RENAME CONSTRAINT "Table_pkey" TO "tables_pkey";
ALTER TABLE "conversations" RENAME CONSTRAINT "Conversation_pkey" TO "conversations_pkey";
ALTER TABLE "conversation_members" RENAME CONSTRAINT "ConversationMember_pkey" TO "conversation_members_pkey";
ALTER TABLE "messages" RENAME CONSTRAINT "Message_pkey" TO "messages_pkey";

-- =====================
-- RENAME FOREIGN KEY CONSTRAINTS (same behavior, name only)
-- =====================
ALTER TABLE "net_users" RENAME CONSTRAINT "NetUser_server_id_fkey" TO "net_users_server_id_fkey";
ALTER TABLE "email_verifications" RENAME CONSTRAINT "EmailVerification_user_id_fkey" TO "email_verifications_user_id_fkey";
ALTER TABLE "verification_factors" RENAME CONSTRAINT "VerificationFactor_user_id_fkey" TO "verification_factors_user_id_fkey";
ALTER TABLE "devices" RENAME CONSTRAINT "Device_session_id_fkey" TO "devices_session_id_fkey";
ALTER TABLE "badgers" RENAME CONSTRAINT "Badger_relay_id_fkey" TO "badgers_relay_id_fkey";
ALTER TABLE "avatar_assets" RENAME CONSTRAINT "AvatarAsset_avatar_id_fkey" TO "avatar_assets_avatar_id_fkey";
ALTER TABLE "world_assets" RENAME CONSTRAINT "WorldAsset_world_id_fkey" TO "world_assets_world_id_fkey";
ALTER TABLE "notifications" RENAME CONSTRAINT "Notification_to_user_id_fkey" TO "notifications_to_user_id_fkey";
ALTER TABLE "presences" RENAME CONSTRAINT "Presence_user_id_fkey" TO "presences_user_id_fkey";
ALTER TABLE "tables" RENAME CONSTRAINT "Table_user_id_fkey" TO "tables_user_id_fkey";
ALTER TABLE "conversation_members" RENAME CONSTRAINT "ConversationMember_conversation_id_fkey" TO "conversation_members_conversation_id_fkey";
ALTER TABLE "messages" RENAME CONSTRAINT "Message_conversation_id_fkey" TO "messages_conversation_id_fkey";

-- Session FK changed from CASCADE to RESTRICT: drop and recreate
ALTER TABLE "sessions" DROP CONSTRAINT "Session_user_id_fkey";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================
-- RENAME INDEXES
-- =====================
ALTER INDEX "NetServer_address_key" RENAME TO "net_servers_address_key";
ALTER INDEX "NetServer_cert_blob_key" RENAME TO "net_servers_cert_blob_key";
ALTER INDEX "User_username_key" RENAME TO "users_username_key";
ALTER INDEX "User_email_key" RENAME TO "users_email_key";
ALTER INDEX "EmailVerification_token_key" RENAME TO "email_verifications_token_key";
ALTER INDEX "EmailVerification_token_idx" RENAME TO "email_verifications_token_idx";
ALTER INDEX "EmailVerification_user_id_verified_idx" RENAME TO "email_verifications_user_id_verified_idx";
ALTER INDEX "VerificationFactor_code_method_idx" RENAME TO "verification_factors_code_method_idx";
ALTER INDEX "Instance_name_key" RENAME TO "instances_name_key";
ALTER INDEX "Device_session_id_ip_user_agent_key" RENAME TO "devices_session_id_ip_user_agent_key";
ALTER INDEX "Badger_token_key" RENAME TO "badgers_token_key";
ALTER INDEX "Badger_relay_id_key" RENAME TO "badgers_relay_id_key";
ALTER INDEX "AvatarAsset_version_engine_platform_avatar_id_idx" RENAME TO "avatar_assets_version_engine_platform_avatar_id_idx";
ALTER INDEX "AvatarAsset_hash_idx" RENAME TO "avatar_assets_hash_idx";
ALTER INDEX "WorldAsset_version_engine_platform_world_id_idx" RENAME TO "world_assets_version_engine_platform_world_id_idx";
ALTER INDEX "Notification_external_id_idx" RENAME TO "notifications_external_id_idx";
ALTER INDEX "Notification_expires_at_idx" RENAME TO "notifications_expires_at_idx";
ALTER INDEX "Table_key_user_id_key" RENAME TO "tables_key_user_id_key";
ALTER INDEX "ConversationMember_user_ref_idx" RENAME TO "conversation_members_user_ref_idx";
ALTER INDEX "ConversationMember_conversation_id_last_read_at_idx" RENAME TO "conversation_members_conversation_id_last_read_at_idx";
ALTER INDEX "ConversationMember_conversation_id_user_ref_key" RENAME TO "conversation_members_conversation_id_user_ref_key";
ALTER INDEX "Message_conversation_id_created_at_idx" RENAME TO "messages_conversation_id_created_at_idx";

-- =====================
-- DROP UNUSED INDEXES
-- =====================
DROP INDEX "Message_sender_ref_idx";       -- sender_ref renamed to author_ref
DROP INDEX "Message_status_retry_count_idx"; -- status/retry_count columns removed
DROP INDEX "Conversation_authority_server_idx"; -- authority_server column removed

-- =====================
-- COLUMN CHANGES: users (presence default: OFFLINE -> ONLINE)
-- =====================
ALTER TABLE "users" ALTER COLUMN "presence" SET DEFAULT 'ONLINE';

-- =====================
-- COLUMN CHANGES: conversations (remove authority_server, rename avatar -> thumbnail)
-- =====================
ALTER TABLE "conversations" DROP COLUMN "authority_server";
ALTER TABLE "conversations" RENAME COLUMN "avatar" TO "thumbnail";

-- =====================
-- COLUMN CHANGES: messages (rename columns, drop obsolete fields)
-- =====================
ALTER TABLE "messages" DROP COLUMN "status";
ALTER TABLE "messages" DROP COLUMN "retry_count";
ALTER TABLE "messages" DROP COLUMN "delivery_errors";
ALTER TABLE "messages" RENAME COLUMN "sender_ref" TO "author_ref";
ALTER TABLE "messages" RENAME COLUMN "reply_to_id" TO "reply_to";
CREATE INDEX "messages_author_ref_idx" ON "messages"("author_ref");

-- =====================
-- DROP tables removed from schema
-- =====================

-- ConversationReference structure changed completely (old: federation-style, new: lookup table)
DROP TABLE "ConversationReference";

-- MessageDeliveryQueue removed from schema
DROP TABLE "MessageDeliveryQueue";

-- =====================
-- RECREATE ConversationReference as conversation_references (new structure)
-- =====================
CREATE TABLE "conversation_references" (
    "id" TEXT NOT NULL,
    "server" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_references_id_server_user_id_key" ON "conversation_references"("id", "server", "user_id");

ALTER TABLE "conversation_references" ADD CONSTRAINT "conversation_references_server_fkey" FOREIGN KEY ("server") REFERENCES "net_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_references" ADD CONSTRAINT "conversation_references_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================
-- CREATE new tables (out_integrities, in_integrities, configs)
-- =====================
CREATE TABLE "out_integrities" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "server_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "out_integrities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "out_integrities_token_key" ON "out_integrities"("token");

ALTER TABLE "out_integrities" ADD CONSTRAINT "out_integrities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "out_integrities" ADD CONSTRAINT "out_integrities_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "net_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "in_integrities" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "server_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "in_integrities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "in_integrities_token_key" ON "in_integrities"("token");

ALTER TABLE "in_integrities" ADD CONSTRAINT "in_integrities_user_id_server_id_fkey" FOREIGN KEY ("user_id", "server_id") REFERENCES "net_users"("id", "server_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "in_integrities" ADD CONSTRAINT "in_integrities_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "net_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configs_pkey" PRIMARY KEY ("key")
);


/*
  Warnings:

  - You are about to drop the column `max_instances` on the `Relay` table. All the data in the column will be lost.
  - You are about to drop the column `use_address` on the `Relay` table. All the data in the column will be lost.
  - You are about to drop the `RelayInstance` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('TOKEN', 'PAIR_KEY');

-- DropForeignKey
ALTER TABLE "Badger" DROP CONSTRAINT "Badger_relay_id_fkey";

-- DropForeignKey
ALTER TABLE "RelayInstance" DROP CONSTRAINT "RelayInstance_instance_id_fkey";

-- DropForeignKey
ALTER TABLE "RelayInstance" DROP CONSTRAINT "RelayInstance_relay_id_fkey";

-- DropIndex
DROP INDEX "Session_token_key";

-- AlterTable
ALTER TABLE "Relay" DROP COLUMN "max_instances",
DROP COLUMN "use_address";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "type" "SessionType" NOT NULL DEFAULT 'TOKEN';

-- DropTable
DROP TABLE "RelayInstance";

-- CreateTable
CREATE TABLE "WebAuthnAuthenticator" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "credential_public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "credential_device_type" TEXT NOT NULL,
    "credential_backed_up" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAuthnAuthenticator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnAuthenticator_credential_id_key" ON "WebAuthnAuthenticator"("credential_id");

-- CreateIndex
CREATE INDEX "WebAuthnAuthenticator_user_id_idx" ON "WebAuthnAuthenticator"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_challenge_idx" ON "WebAuthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_user_id_idx" ON "WebAuthnChallenge"("user_id");

-- AddForeignKey
ALTER TABLE "Badger" ADD CONSTRAINT "Badger_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "Relay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnAuthenticator" ADD CONSTRAINT "WebAuthnAuthenticator_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

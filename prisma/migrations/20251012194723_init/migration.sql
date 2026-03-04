/*
  Warnings:

  - You are about to drop the column `type` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the `WebAuthnAuthenticator` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WebAuthnChallenge` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "WebAuthnAuthenticator" DROP CONSTRAINT "WebAuthnAuthenticator_user_id_fkey";

-- DropForeignKey
ALTER TABLE "WebAuthnChallenge" DROP CONSTRAINT "WebAuthnChallenge_user_id_fkey";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "type",
ADD COLUMN     "public_key" BYTEA;

-- DropTable
DROP TABLE "WebAuthnAuthenticator";

-- DropTable
DROP TABLE "WebAuthnChallenge";

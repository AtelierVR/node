/*
  Warnings:

  - You are about to drop the column `token` on the `VerificationFactor` table. All the data in the column will be lost.
  - You are about to drop the column `verified` on the `VerificationFactor` table. All the data in the column will be lost.
  - Added the required column `cert_blob` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cert_expires` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "VerificationFactor_user_id_method_verified_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cert_blob" BYTEA NOT NULL,
ADD COLUMN     "cert_expires" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "VerificationFactor" DROP COLUMN "token",
DROP COLUMN "verified";

-- CreateTable
CREATE TABLE "Table" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "user_ref" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Table_key_user_ref_key" ON "Table"("key", "user_ref");

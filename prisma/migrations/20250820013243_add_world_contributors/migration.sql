/*
  Warnings:

  - You are about to drop the column `public` on the `NetServer` table. All the data in the column will be lost.
  - You are about to drop the `Challenge` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[cert_blob]` on the table `NetServer` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cert_blob` to the `NetServer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cert_expires` to the `NetServer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `key_blob` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Challenge" DROP CONSTRAINT "Challenge_server_id_fkey";

-- DropIndex
DROP INDEX "NetServer_public_key";

-- AlterTable
ALTER TABLE "NetServer" DROP COLUMN "public",
ADD COLUMN     "cert_blob" BYTEA NOT NULL,
ADD COLUMN     "cert_expires" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "key_blob" BYTEA NOT NULL;

-- AlterTable
ALTER TABLE "World" ADD COLUMN     "contributor_refs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- DropTable
DROP TABLE "Challenge";

-- CreateIndex
CREATE UNIQUE INDEX "NetServer_cert_blob_key" ON "NetServer"("cert_blob");

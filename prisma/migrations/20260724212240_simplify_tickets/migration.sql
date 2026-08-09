/*
  Warnings:

  - You are about to drop the column `author_ref` on the `tickets` table. All the data in the column will be lost.
  - Added the required column `email` to the `tickets` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "tickets_author_ref_idx";

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "author_ref",
ADD COLUMN     "email" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "tickets_email_idx" ON "tickets"("email");

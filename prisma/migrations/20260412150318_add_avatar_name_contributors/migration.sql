/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `avatars` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "contributor_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "name" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "avatars_name_key" ON "avatars"("name");

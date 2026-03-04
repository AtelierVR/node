/*
  Warnings:

  - You are about to drop the column `contributor_refs` on the `Avatar` table. All the data in the column will be lost.
  - You are about to drop the column `mod_refs` on the `AvatarAsset` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Avatar" DROP COLUMN "contributor_refs";

-- AlterTable
ALTER TABLE "AvatarAsset" DROP COLUMN "mod_refs";

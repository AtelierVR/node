/*
  Warnings:

  - Made the column `size` on table `AvatarAsset` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "AvatarAsset" ALTER COLUMN "size" SET NOT NULL;

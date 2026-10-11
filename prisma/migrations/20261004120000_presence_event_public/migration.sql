-- AlterEnum
-- Adds the `event` and `public` presence statuses to the visibility ladder.
ALTER TYPE "presence_status" ADD VALUE IF NOT EXISTS 'EVENT';
ALTER TYPE "presence_status" ADD VALUE IF NOT EXISTS 'PUBLIC';

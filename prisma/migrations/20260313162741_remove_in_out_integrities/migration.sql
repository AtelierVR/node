/*
  Warnings:

  - You are about to drop the `in_integrities` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `out_integrities` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "in_integrities" DROP CONSTRAINT "in_integrities_server_id_fkey";

-- DropForeignKey
ALTER TABLE "in_integrities" DROP CONSTRAINT "in_integrities_user_id_server_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_to_user_id_fkey";

-- DropForeignKey
ALTER TABLE "out_integrities" DROP CONSTRAINT "out_integrities_server_id_fkey";

-- DropForeignKey
ALTER TABLE "out_integrities" DROP CONSTRAINT "out_integrities_user_id_fkey";

-- DropForeignKey
ALTER TABLE "presences" DROP CONSTRAINT "presences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "world_assets" DROP CONSTRAINT "world_assets_world_id_fkey";

-- DropTable
DROP TABLE "in_integrities";

-- DropTable
DROP TABLE "out_integrities";

-- AddForeignKey
ALTER TABLE "world_assets" ADD CONSTRAINT "world_assets_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presences" ADD CONSTRAINT "presences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

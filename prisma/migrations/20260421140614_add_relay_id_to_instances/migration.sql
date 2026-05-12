-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "relay_id" INTEGER;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "relays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

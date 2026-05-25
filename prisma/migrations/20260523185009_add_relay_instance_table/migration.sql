/*
  Warnings:

  - You are about to drop the column `relay_id` on the `instances` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "instances" DROP CONSTRAINT "instances_relay_id_fkey";

-- AlterTable
ALTER TABLE "instances" DROP COLUMN "relay_id";

-- AlterTable
ALTER TABLE "relays" ADD COLUMN     "max_instances" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "relay_instances" (
    "id" SERIAL NOT NULL,
    "relay_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relay_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "relay_instances_instance_id_key" ON "relay_instances"("instance_id");

-- CreateIndex
CREATE INDEX "relay_instances_relay_id_idx" ON "relay_instances"("relay_id");

-- AddForeignKey
ALTER TABLE "relay_instances" ADD CONSTRAINT "relay_instances_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "relays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_instances" ADD CONSTRAINT "relay_instances_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

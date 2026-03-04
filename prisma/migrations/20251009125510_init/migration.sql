/*
  Warnings:

  - You are about to drop the column `user_ref` on the `Table` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[key,user_id]` on the table `Table` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `user_id` to the `Table` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `value` on the `Table` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropIndex
DROP INDEX "Table_key_user_ref_key";

-- AlterTable
ALTER TABLE "Table" DROP COLUMN "user_ref",
ADD COLUMN     "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
ADD COLUMN     "user_id" INTEGER NOT NULL,
DROP COLUMN "value",
ADD COLUMN     "value" BYTEA NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Table_key_user_id_key" ON "Table"("key", "user_id");

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

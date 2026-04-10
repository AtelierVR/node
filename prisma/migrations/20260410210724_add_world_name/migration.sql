-- AlterTable: add nullable name column
ALTER TABLE "worlds" ADD COLUMN "name" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "worlds_name_key" ON "worlds"("name");

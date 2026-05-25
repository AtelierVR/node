-- Rename max_instances → max_link on the relays table
ALTER TABLE "relays" RENAME COLUMN "max_instances" TO "max_link";

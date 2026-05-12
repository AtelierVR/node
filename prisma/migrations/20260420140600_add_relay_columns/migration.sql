-- AlterTable: add missing columns to relays that were defined in schema but never migrated
ALTER TABLE "relays"
    ADD COLUMN IF NOT EXISTS "label"       TEXT,
    ADD COLUMN IF NOT EXISTS "provider"    TEXT NOT NULL DEFAULT 'docker',
    ADD COLUMN IF NOT EXISTS "provider_id" TEXT,
    ADD COLUMN IF NOT EXISTS "tags"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A device may have no User-Agent: clients are allowed to send none (or an
-- empty one), which is now stored as NULL instead of an empty string.
ALTER TABLE "devices" ALTER COLUMN "user_agent" DROP NOT NULL;

-- Normalize the existing empty User-Agents.
UPDATE "devices" SET "user_agent" = NULL WHERE "user_agent" = '';

-- `NULLS NOT DISTINCT` keeps `(session_id, ip, NULL)` unique: PostgreSQL treats
-- NULLs as distinct by default, so the unique key would no longer prevent
-- duplicate rows for a client without any User-Agent.
DROP INDEX "devices_session_id_ip_user_agent_key";
CREATE UNIQUE INDEX "devices_session_id_ip_user_agent_key"
  ON "devices"("session_id", "ip", "user_agent") NULLS NOT DISTINCT;

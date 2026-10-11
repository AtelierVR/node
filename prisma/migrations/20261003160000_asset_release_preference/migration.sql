-- Preferred release exposed by the API: NULL = auto (latest release).
ALTER TABLE "assets" ADD COLUMN "release" INTEGER;

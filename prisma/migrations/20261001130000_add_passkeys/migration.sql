-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoverable" BOOLEAN NOT NULL DEFAULT false,
    "device_type" TEXT NOT NULL DEFAULT 'singleDevice',
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "aaguid" TEXT,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

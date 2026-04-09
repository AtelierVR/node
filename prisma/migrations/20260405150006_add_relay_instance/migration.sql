-- CreateTable
CREATE TABLE "relays" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_tokens" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "relay_id" INTEGER NOT NULL,

    CONSTRAINT "relay_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instances" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 10,
    "world_ref" TEXT NOT NULL,
    "owner_ref" TEXT NOT NULL,
    "tags" TEXT[],
    "thumbnail" TEXT,
    "use_whitelist" BOOLEAN NOT NULL DEFAULT false,
    "whitelist_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "use_password" BOOLEAN NOT NULL DEFAULT false,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "relay_tokens_token_key" ON "relay_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "relay_tokens_relay_id_key" ON "relay_tokens"("relay_id");

-- CreateIndex
CREATE UNIQUE INDEX "instances_name_key" ON "instances"("name");

-- AddForeignKey
ALTER TABLE "relay_tokens" ADD CONSTRAINT "relay_tokens_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "relays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

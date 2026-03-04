-- CreateTable
CREATE TABLE "VerificationFactor" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "token" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationFactor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationFactor_user_id_method_verified_idx" ON "VerificationFactor"("user_id", "method", "verified");

-- CreateIndex
CREATE INDEX "VerificationFactor_code_method_idx" ON "VerificationFactor"("code", "method");

-- AddForeignKey
ALTER TABLE "VerificationFactor" ADD CONSTRAINT "VerificationFactor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

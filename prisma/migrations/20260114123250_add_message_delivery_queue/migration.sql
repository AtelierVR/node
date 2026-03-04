-- CreateTable
CREATE TABLE "MessageDeliveryQueue" (
    "id" SERIAL NOT NULL,
    "message_id" TEXT NOT NULL,
    "target_server" TEXT NOT NULL,
    "target_user_ref" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageDeliveryQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageDeliveryQueue_next_retry_at_retry_count_idx" ON "MessageDeliveryQueue"("next_retry_at", "retry_count");

-- CreateIndex
CREATE INDEX "MessageDeliveryQueue_message_id_idx" ON "MessageDeliveryQueue"("message_id");

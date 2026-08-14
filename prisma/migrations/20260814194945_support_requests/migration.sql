-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "area" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "replyEmail" TEXT NOT NULL,
    "urgency" TEXT,
    "staffEmail" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "diagnostics" JSONB,
    "status" TEXT NOT NULL DEFAULT 'new',
    "emailedAt" TIMESTAMP(3),
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportRequest_shopId_idx" ON "SupportRequest"("shopId");

-- CreateIndex
CREATE INDEX "SupportRequest_createdAt_idx" ON "SupportRequest"("createdAt");

-- CreateIndex
CREATE INDEX "SupportRequest_status_idx" ON "SupportRequest"("status");

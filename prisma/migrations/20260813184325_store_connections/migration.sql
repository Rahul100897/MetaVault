-- CreateTable
CREATE TABLE "StoreConnection" (
    "id" TEXT NOT NULL,
    "shopA" TEXT NOT NULL,
    "shopB" TEXT,
    "code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "StoreConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreConnection_code_key" ON "StoreConnection"("code");

-- CreateIndex
CREATE INDEX "StoreConnection_shopA_idx" ON "StoreConnection"("shopA");

-- CreateIndex
CREATE INDEX "StoreConnection_shopB_idx" ON "StoreConnection"("shopB");

-- CreateIndex
CREATE INDEX "StoreConnection_status_idx" ON "StoreConnection"("status");

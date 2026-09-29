-- AlterEnum
ALTER TYPE "ValuationEntryType" ADD VALUE 'PURCHASE_RETURN';

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "goodsAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "creditTotal" DECIMAL(12,2) NOT NULL,
    "costValue" DECIMAL(12,2) NOT NULL,
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundMethod" TEXT,
    "payerPhone" TEXT,
    "transactionId" TEXT,
    "refundReference" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "costValue" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_returnNumber_key" ON "purchase_returns"("returnNumber");

-- CreateIndex
CREATE INDEX "purchase_returns_purchaseOrderId_idx" ON "purchase_returns"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_returns_supplierId_idx" ON "purchase_returns"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_returns_returnDate_idx" ON "purchase_returns"("returnDate");

-- CreateIndex
CREATE INDEX "purchase_returns_userId_createdAt_idx" ON "purchase_returns"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchaseReturnId_idx" ON "purchase_return_items"("purchaseReturnId");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchaseOrderItemId_idx" ON "purchase_return_items"("purchaseOrderItemId");

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Returned quantities are positive; a refund never exceeds the credit.
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_refund_valid"
  CHECK ("refundAmount" >= 0 AND "refundAmount" <= "creditTotal" AND "creditTotal" >= 0 AND "costValue" >= 0);

-- Permissions for the new module (generated from DEFAULT_PERMISSIONS).
INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES
  ('rp_warehouse_manager_purchase_returns', 'WAREHOUSE_MANAGER', 'purchase_returns', true, true, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_purchase_returns', 'SALES_MANAGER', 'purchase_returns', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_purchase_returns', 'SALES_OFFICER', 'purchase_returns', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_purchase_returns', 'ACCOUNTANT', 'purchase_returns', true, false, false, false, 'ALL', NULL, now()),
  ('rp_student_purchase_returns', 'STUDENT', 'purchase_returns', true, true, false, false, 'OWN', NULL, now())
ON CONFLICT ("role", "module") DO NOTHING;

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('RESELLABLE', 'DAMAGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ValuationEntryType" ADD VALUE 'SALES_RETURN';
ALTER TYPE "ValuationEntryType" ADD VALUE 'SALES_RETURN_LOSS';

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "cogs" DECIMAL(12,2) NOT NULL,
    "lossValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundMethod" TEXT,
    "payerPhone" TEXT,
    "transactionId" TEXT,
    "refundReference" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_items" (
    "id" TEXT NOT NULL,
    "salesReturnId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "cogs" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_returnNumber_key" ON "sales_returns"("returnNumber");

-- CreateIndex
CREATE INDEX "sales_returns_salesOrderId_idx" ON "sales_returns"("salesOrderId");

-- CreateIndex
CREATE INDEX "sales_returns_customerId_idx" ON "sales_returns"("customerId");

-- CreateIndex
CREATE INDEX "sales_returns_returnDate_idx" ON "sales_returns"("returnDate");

-- CreateIndex
CREATE INDEX "sales_returns_userId_createdAt_idx" ON "sales_returns"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_return_items_salesReturnId_idx" ON "sales_return_items"("salesReturnId");

-- CreateIndex
CREATE INDEX "sales_return_items_salesOrderItemId_idx" ON "sales_return_items"("salesOrderItemId");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Returned units never exceed the delivered units; returned quantities are
-- positive; a refund never exceeds the credit note.
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_returned_valid"
  CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "deliveredQuantity");
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_refund_valid"
  CHECK ("refundAmount" >= 0 AND "refundAmount" <= "total" AND "total" >= 0 AND "cogs" >= 0 AND "lossValue" >= 0 AND "lossValue" <= "cogs");

-- Permissions for the new module (generated from DEFAULT_PERMISSIONS).
INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES
  ('rp_warehouse_manager_sales_returns', 'WAREHOUSE_MANAGER', 'sales_returns', true, true, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_sales_returns', 'SALES_MANAGER', 'sales_returns', true, true, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_sales_returns', 'SALES_OFFICER', 'sales_returns', true, true, false, false, 'OWN', NULL, now()),
  ('rp_accountant_sales_returns', 'ACCOUNTANT', 'sales_returns', true, false, false, false, 'ALL', NULL, now()),
  ('rp_student_sales_returns', 'STUDENT', 'sales_returns', true, true, false, false, 'OWN', NULL, now())
ON CONFLICT ("role", "module") DO NOTHING;

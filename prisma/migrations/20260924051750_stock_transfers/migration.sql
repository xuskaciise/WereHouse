-- Warehouse stock transfers (lib/stock-transfers.ts): statuses, dispatch /
-- receive / close / cancel history, transfer costs and valuation entry types.

ALTER TYPE "ValuationEntryType" ADD VALUE IF NOT EXISTS 'TRANSFER_LOSS';
ALTER TYPE "ValuationEntryType" ADD VALUE IF NOT EXISTS 'TRANSFER_RETURN';

BEGIN;

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferReceiptType" AS ENUM ('RECEIVE', 'CLOSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

-- AlterTable
ALTER TABLE "inventory_valuation_entries" ADD COLUMN     "stockTransferItemId" TEXT;

-- AlterTable
ALTER TABLE "stock_transfer_items" ADD COLUMN     "allocatedCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "appliedCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lossCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lostQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedById" TEXT,
ADD COLUMN     "expectedDate" TIMESTAMP(3),
ADD COLUMN     "instant" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "TransferStatus" USING (
  CASE "status"::text
    WHEN 'SHIPPED' THEN 'IN_TRANSIT'
    WHEN 'PARTIALLY_RECEIVED' THEN 'PARTIALLY_RECEIVED'
    WHEN 'DELIVERED' THEN 'RECEIVED'
    WHEN 'CONFIRMED' THEN 'RECEIVED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE 'DRAFT'
  END
)::"TransferStatus",
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "stockTransferCostId" TEXT;

-- CreateTable
CREATE TABLE "stock_transfer_receipts" (
    "id" TEXT NOT NULL,
    "stockTransferId" TEXT NOT NULL,
    "type" "TransferReceiptType" NOT NULL DEFAULT 'RECEIVE',
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "stockTransferItemId" TEXT NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "lostQuantity" INTEGER NOT NULL DEFAULT 0,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,

    CONSTRAINT "stock_transfer_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_events" (
    "id" TEXT NOT NULL,
    "stockTransferId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "data" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_costs" (
    "id" TEXT NOT NULL,
    "stockTransferId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "paidToSupplierId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "costDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfer_receipts_stockTransferId_idx" ON "stock_transfer_receipts"("stockTransferId");

-- CreateIndex
CREATE INDEX "stock_transfer_receipt_items_stockTransferItemId_idx" ON "stock_transfer_receipt_items"("stockTransferItemId");

-- CreateIndex
CREATE INDEX "stock_transfer_events_stockTransferId_createdAt_idx" ON "stock_transfer_events"("stockTransferId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_transfer_costs_stockTransferId_idx" ON "stock_transfer_costs"("stockTransferId");

-- CreateIndex
CREATE INDEX "stock_transfer_costs_paidToSupplierId_idx" ON "stock_transfer_costs"("paidToSupplierId");

-- CreateIndex
CREATE INDEX "stock_transfer_items_stockTransferId_idx" ON "stock_transfer_items"("stockTransferId");

-- CreateIndex
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers"("status");

-- CreateIndex
CREATE INDEX "stock_transfers_fromWarehouseId_idx" ON "stock_transfers"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "stock_transfers_toWarehouseId_idx" ON "stock_transfers"("toWarehouseId");

-- CreateIndex
CREATE INDEX "stock_transfers_userId_createdAt_idx" ON "stock_transfers"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_stockTransferCostId_fkey" FOREIGN KEY ("stockTransferCostId") REFERENCES "stock_transfer_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_receipts" ADD CONSTRAINT "stock_transfer_receipts_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_receipts" ADD CONSTRAINT "stock_transfer_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_receipt_items" ADD CONSTRAINT "stock_transfer_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "stock_transfer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_receipt_items" ADD CONSTRAINT "stock_transfer_receipt_items_stockTransferItemId_fkey" FOREIGN KEY ("stockTransferItemId") REFERENCES "stock_transfer_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_events" ADD CONSTRAINT "stock_transfer_events_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_events" ADD CONSTRAINT "stock_transfer_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_costs" ADD CONSTRAINT "stock_transfer_costs_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_costs" ADD CONSTRAINT "stock_transfer_costs_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "landed_cost_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_costs" ADD CONSTRAINT "stock_transfer_costs_paidToSupplierId_fkey" FOREIGN KEY ("paidToSupplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_costs" ADD CONSTRAINT "stock_transfer_costs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation_entries" ADD CONSTRAINT "inventory_valuation_entries_stockTransferItemId_fkey" FOREIGN KEY ("stockTransferItemId") REFERENCES "stock_transfer_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions for the new module (generated from DEFAULT_PERMISSIONS).
INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES
  ('rp_warehouse_manager_stock_transfers', 'WAREHOUSE_MANAGER', 'stock_transfers', true, true, true, true, 'ALL', NULL, now()),
  ('rp_sales_manager_stock_transfers', 'SALES_MANAGER', 'stock_transfers', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_stock_transfers', 'SALES_OFFICER', 'stock_transfers', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_stock_transfers', 'ACCOUNTANT', 'stock_transfers', true, false, false, false, 'ALL', NULL, now()),
  ('rp_student_stock_transfers', 'STUDENT', 'stock_transfers', true, true, true, true, 'OWN', NULL, now())
ON CONFLICT ("role", "module") DO NOTHING;

-- Quantities are never negative and never exceed what was dispatched.
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_quantities_valid" CHECK (
  "quantity" > 0 AND "dispatchedQuantity" >= 0 AND "receivedQuantity" >= 0 AND "lostQuantity" >= 0
  AND "returnedQuantity" >= 0
  AND "receivedQuantity" + "lostQuantity" + "returnedQuantity" <= "dispatchedQuantity"
  AND "unitCost" >= 0 AND "allocatedCost" >= 0
) NOT VALID;
ALTER TABLE "stock_transfer_costs" ADD CONSTRAINT "stock_transfer_costs_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_warehouses_differ" CHECK ("fromWarehouseId" <> "toWarehouseId") NOT VALID;

COMMIT;

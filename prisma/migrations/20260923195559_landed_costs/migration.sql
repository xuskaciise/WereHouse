-- Landed costs on purchase orders, weighted average cost per warehouse and
-- COGS on sales lines (lib/landed-costs.ts, lib/stock-valuation.ts).
-- Existing purchase orders keep working with zero additional costs.
BEGIN;

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('GOODS', 'SERVICE_PROVIDER');

-- CreateEnum
CREATE TYPE "LandedCostAmountType" AS ENUM ('FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "LandedCostPercentBase" AS ENUM ('GOODS', 'GOODS_PLUS_FIXED');

-- CreateEnum
CREATE TYPE "LandedCostAllocation" AS ENUM ('VALUE', 'QUANTITY', 'WEIGHT', 'VOLUME', 'MANUAL');

-- CreateEnum
CREATE TYPE "ValuationEntryType" AS ENUM ('RECEIPT', 'LANDED_COST', 'COGS_ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "volume" DECIMAL(12,4),
ADD COLUMN     "weight" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "appliedLandedCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "landedCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "costsFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "costsFinalizedById" TEXT;

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "costEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock" ADD COLUMN     "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "landedCostId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "type" "SupplierType" NOT NULL DEFAULT 'GOODS';

-- CreateTable
CREATE TABLE "landed_cost_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landed_cost_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_landed_costs" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "paidToSupplierId" TEXT NOT NULL,
    "amountType" "LandedCostAmountType" NOT NULL DEFAULT 'FIXED',
    "value" DECIMAL(12,4) NOT NULL,
    "percentBase" "LandedCostPercentBase" NOT NULL DEFAULT 'GOODS',
    "amount" DECIMAL(12,2) NOT NULL,
    "allocationMethod" "LandedCostAllocation" NOT NULL DEFAULT 'VALUE',
    "reference" TEXT,
    "costDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_landed_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_landed_cost_allocations" (
    "id" TEXT NOT NULL,
    "landedCostId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "manualAmount" DECIMAL(12,2),
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_landed_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_logs" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "landedCostId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landed_cost_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_valuation_entries" (
    "id" TEXT NOT NULL,
    "type" "ValuationEntryType" NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL,
    "purchaseOrderItemId" TEXT,
    "landedCostId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_valuation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "landed_cost_types_name_key" ON "landed_cost_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "landed_cost_types_nameKey_key" ON "landed_cost_types"("nameKey");

-- CreateIndex
CREATE INDEX "purchase_landed_costs_purchaseOrderId_idx" ON "purchase_landed_costs"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_landed_costs_paidToSupplierId_idx" ON "purchase_landed_costs"("paidToSupplierId");

-- CreateIndex
CREATE INDEX "purchase_landed_cost_allocations_purchaseOrderItemId_idx" ON "purchase_landed_cost_allocations"("purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_landed_cost_allocations_landedCostId_purchaseOrder_key" ON "purchase_landed_cost_allocations"("landedCostId", "purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "landed_cost_logs_purchaseOrderId_createdAt_idx" ON "landed_cost_logs"("purchaseOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_valuation_entries_type_createdAt_idx" ON "inventory_valuation_entries"("type", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_valuation_entries_productId_warehouseId_idx" ON "inventory_valuation_entries"("productId", "warehouseId");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "purchase_landed_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_landed_costs" ADD CONSTRAINT "purchase_landed_costs_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_landed_costs" ADD CONSTRAINT "purchase_landed_costs_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "landed_cost_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_landed_costs" ADD CONSTRAINT "purchase_landed_costs_paidToSupplierId_fkey" FOREIGN KEY ("paidToSupplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_landed_costs" ADD CONSTRAINT "purchase_landed_costs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_landed_cost_allocations" ADD CONSTRAINT "purchase_landed_cost_allocations_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "purchase_landed_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_landed_cost_allocations" ADD CONSTRAINT "purchase_landed_cost_allocations_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_logs" ADD CONSTRAINT "landed_cost_logs_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_logs" ADD CONSTRAINT "landed_cost_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation_entries" ADD CONSTRAINT "inventory_valuation_entries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation_entries" ADD CONSTRAINT "inventory_valuation_entries_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation_entries" ADD CONSTRAINT "inventory_valuation_entries_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation_entries" ADD CONSTRAINT "inventory_valuation_entries_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "purchase_landed_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation_entries" ADD CONSTRAINT "inventory_valuation_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing stock starts at the product's cost price as its average cost.
UPDATE "stock" AS s SET "avgCost" = p."costPrice" FROM "products" AS p WHERE p."id" = s."productId";

-- Existing sales lines: cost unknown at the time of sale -> current product
-- cost, flagged as estimated (shown in the reports).
UPDATE "sales_order_items" AS i SET "unitCost" = p."costPrice", "costEstimated" = true
FROM "products" AS p WHERE p."id" = i."productId";

-- Default cost types (editable on the Landed Cost Types page).
INSERT INTO "landed_cost_types" ("id", "name", "nameKey", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('lct_shipment', 'Shipment', 'shipment', true, 1, now(), now()),
  ('lct_customs_clearance', 'Customs & Clearance', 'customs & clearance', true, 2, now(), now()),
  ('lct_transportation', 'Transportation', 'transportation', true, 3, now(), now()),
  ('lct_commission', 'Commission', 'commission', true, 4, now(), now()),
  ('lct_other', 'Other', 'other', true, 5, now(), now());

-- Permissions for the new modules (generated from DEFAULT_PERMISSIONS).
INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES
  ('rp_warehouse_manager_landed_costs', 'WAREHOUSE_MANAGER', 'landed_costs', true, true, true, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_landed_costs_admin', 'WAREHOUSE_MANAGER', 'landed_costs_admin', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_landed_cost_types', 'WAREHOUSE_MANAGER', 'landed_cost_types', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_product_cost', 'WAREHOUSE_MANAGER', 'product_cost', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_landed_costs', 'SALES_MANAGER', 'landed_costs', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_landed_costs_admin', 'SALES_MANAGER', 'landed_costs_admin', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_landed_cost_types', 'SALES_MANAGER', 'landed_cost_types', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_product_cost', 'SALES_MANAGER', 'product_cost', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_landed_costs', 'SALES_OFFICER', 'landed_costs', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_landed_costs_admin', 'SALES_OFFICER', 'landed_costs_admin', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_landed_cost_types', 'SALES_OFFICER', 'landed_cost_types', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_product_cost', 'SALES_OFFICER', 'product_cost', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_landed_costs', 'ACCOUNTANT', 'landed_costs', true, true, true, true, 'ALL', NULL, now()),
  ('rp_accountant_landed_costs_admin', 'ACCOUNTANT', 'landed_costs_admin', true, false, true, false, 'ALL', NULL, now()),
  ('rp_accountant_landed_cost_types', 'ACCOUNTANT', 'landed_cost_types', true, true, true, true, 'ALL', NULL, now()),
  ('rp_accountant_product_cost', 'ACCOUNTANT', 'product_cost', true, false, false, false, 'ALL', NULL, now()),
  ('rp_student_landed_costs', 'STUDENT', 'landed_costs', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_landed_costs_admin', 'STUDENT', 'landed_costs_admin', true, false, true, false, 'OWN', NULL, now()),
  ('rp_student_landed_cost_types', 'STUDENT', 'landed_cost_types', true, false, false, false, 'ALL', NULL, now()),
  ('rp_student_product_cost', 'STUDENT', 'product_cost', true, false, false, false, 'OWN', NULL, now())
ON CONFLICT ("role", "module") DO NOTHING;

-- Amounts and costs are never negative; a percentage is at most 100.
ALTER TABLE "purchase_landed_costs" ADD CONSTRAINT "purchase_landed_costs_amounts_valid"
  CHECK ("value" >= 0 AND "amount" >= 0 AND ("amountType" <> 'PERCENT' OR "value" <= 100));
ALTER TABLE "purchase_landed_cost_allocations" ADD CONSTRAINT "purchase_landed_cost_allocations_amounts_valid"
  CHECK ("amount" >= 0 AND ("manualAmount" IS NULL OR "manualAmount" >= 0));
ALTER TABLE "stock" ADD CONSTRAINT "stock_avg_cost_non_negative" CHECK ("avgCost" >= 0) NOT VALID;
ALTER TABLE "products" ADD CONSTRAINT "products_weight_volume_non_negative"
  CHECK (("weight" IS NULL OR "weight" >= 0) AND ("volume" IS NULL OR "volume" >= 0)) NOT VALID;

COMMIT;

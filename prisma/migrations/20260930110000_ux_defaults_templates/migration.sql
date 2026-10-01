-- AlterTable
ALTER TABLE "users" ADD COLUMN     "defaultWarehouseId" TEXT,
ADD COLUMN     "defaultWarehouseLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "landed_cost_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landed_cost_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "paidToSupplierId" TEXT,
    "amountType" "LandedCostAmountType" NOT NULL DEFAULT 'FIXED',
    "value" DECIMAL(12,4) NOT NULL,
    "percentBase" "LandedCostPercentBase" NOT NULL DEFAULT 'GOODS',
    "allocationMethod" "LandedCostAllocation" NOT NULL DEFAULT 'VALUE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "landed_cost_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "landed_cost_templates_nameKey_key" ON "landed_cost_templates"("nameKey");

-- CreateIndex
CREATE INDEX "landed_cost_template_items_templateId_idx" ON "landed_cost_template_items"("templateId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultWarehouseId_fkey" FOREIGN KEY ("defaultWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_templates" ADD CONSTRAINT "landed_cost_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_template_items" ADD CONSTRAINT "landed_cost_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "landed_cost_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_template_items" ADD CONSTRAINT "landed_cost_template_items_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "landed_cost_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_template_items" ADD CONSTRAINT "landed_cost_template_items_paidToSupplierId_fkey" FOREIGN KEY ("paidToSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Template values are never negative; a percentage is at most 100.
ALTER TABLE "landed_cost_template_items" ADD CONSTRAINT "landed_cost_template_items_value_valid"
  CHECK ("value" >= 0 AND ("amountType" <> 'PERCENT' OR "value" <= 100));

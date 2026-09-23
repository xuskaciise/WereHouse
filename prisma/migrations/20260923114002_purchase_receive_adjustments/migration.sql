-- Purchase receive adjustments: over-receiving, closing the remainder of a
-- line, editing quantities before the first receive, with a full history.
-- One transaction: the migration either applies completely or not at all.
BEGIN;

-- CreateEnum
CREATE TYPE "PurchaseAdjustmentType" AS ENUM ('EDIT', 'OVER_RECEIVE', 'CLOSE_REMAINING');

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "closed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalQuantity" INTEGER;

-- Existing lines were never adjusted: the original quantity is the current one.
UPDATE "purchase_order_items" SET "originalQuantity" = "quantity";
ALTER TABLE "purchase_order_items" ALTER COLUMN "originalQuantity" SET NOT NULL;

-- CreateTable
CREATE TABLE "purchase_order_item_adjustments" (
    "id" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "purchaseReceiveId" TEXT,
    "type" "PurchaseAdjustmentType" NOT NULL,
    "oldQuantity" INTEGER NOT NULL,
    "newQuantity" INTEGER NOT NULL,
    "reason" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_item_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_item_adjustments_purchaseOrderItemId_idx" ON "purchase_order_item_adjustments"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "purchase_order_item_adjustments_purchaseReceiveId_idx" ON "purchase_order_item_adjustments"("purchaseReceiveId");

-- AddForeignKey
ALTER TABLE "purchase_order_item_adjustments" ADD CONSTRAINT "purchase_order_item_adjustments_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item_adjustments" ADD CONSTRAINT "purchase_order_item_adjustments_purchaseReceiveId_fkey" FOREIGN KEY ("purchaseReceiveId") REFERENCES "purchase_receives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item_adjustments" ADD CONSTRAINT "purchase_order_item_adjustments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quantities can never be negative, and a line quantity of 0 is only allowed
-- once its remainder is closed. NOT VALID: enforced for every new or changed
-- row without re-checking historical rows, so this can never fail on old data.
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_quantity_valid"
  CHECK ("quantity" >= 0 AND ("quantity" > 0 OR "closed")) NOT VALID;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_original_quantity_positive"
  CHECK ("originalQuantity" > 0) NOT VALID;
ALTER TABLE "purchase_receive_items" ADD CONSTRAINT "purchase_receive_items_quantity_non_negative"
  CHECK ("quantityReceived" >= 0) NOT VALID;
ALTER TABLE "purchase_order_item_adjustments" ADD CONSTRAINT "purchase_order_item_adjustments_quantities_non_negative"
  CHECK ("oldQuantity" >= 0 AND "newQuantity" >= 0);

COMMIT;

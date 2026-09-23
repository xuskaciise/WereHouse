-- Discounts on sales orders: optional per-line discount and an order-level
-- discount (percent or fixed amount). Existing orders keep their values: new
-- columns default to "no discount" and the existing "discount" column (the
-- order-level discount amount) is unchanged.
BEGIN;

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "itemDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0;


-- Discounts are never negative and a percentage is at most 100. NOT VALID:
-- enforced for new/changed rows without re-checking historical rows.
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_discount_valid"
  CHECK ("discountAmount" >= 0 AND "discountValue" >= 0 AND ("discountType" IS DISTINCT FROM 'PERCENT' OR "discountValue" <= 100)) NOT VALID;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_discount_valid"
  CHECK ("discount" >= 0 AND "itemDiscount" >= 0 AND "discountValue" >= 0 AND ("discountType" IS DISTINCT FROM 'PERCENT' OR "discountValue" <= 100)) NOT VALID;

COMMIT;

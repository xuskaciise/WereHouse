-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "deliveredQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "releasedQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "reservedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sales_deliveries" (
    "id" TEXT NOT NULL,
    "deliveryNumber" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "cogs" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_delivery_items" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "cogs" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sales_delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_events" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "data" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_deliveries_deliveryNumber_key" ON "sales_deliveries"("deliveryNumber");

-- CreateIndex
CREATE INDEX "sales_deliveries_salesOrderId_idx" ON "sales_deliveries"("salesOrderId");

-- CreateIndex
CREATE INDEX "sales_deliveries_deliveredAt_idx" ON "sales_deliveries"("deliveredAt");

-- CreateIndex
CREATE INDEX "sales_deliveries_userId_createdAt_idx" ON "sales_deliveries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_delivery_items_deliveryId_idx" ON "sales_delivery_items"("deliveryId");

-- CreateIndex
CREATE INDEX "sales_delivery_items_salesOrderItemId_idx" ON "sales_delivery_items"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "sales_order_events_salesOrderId_createdAt_idx" ON "sales_order_events"("salesOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_orders_reservedUntil_idx" ON "sales_orders"("reservedUntil");

-- AddForeignKey
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_delivery_items" ADD CONSTRAINT "sales_delivery_items_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "sales_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_delivery_items" ADD CONSTRAINT "sales_delivery_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_events" ADD CONSTRAINT "sales_order_events_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_events" ADD CONSTRAINT "sales_order_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sales order status: own enum (DRAFT -> CONFIRMED -> PARTIALLY_DELIVERED ->
-- DELIVERED, or CANCELLED). Before this migration every sales order deducted
-- its stock when it was created, so every order that is not cancelled already
-- left the warehouse: it becomes DELIVERED with one delivery carrying exactly
-- the order totals and line costs (stock, customer balances, revenue and COGS
-- stay the same). A cancelled order that deducted stock cannot be mapped
-- safely and stops the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "sales_orders" so
    WHERE so."status" = 'CANCELLED'
      AND EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."referenceId" = so."id" AND m."type" = 'OUT')
  ) THEN
    RAISE EXCEPTION 'A CANCELLED sales order has deducted stock; resolve it before the sales-reservations migration';
  END IF;
END $$;

ALTER TABLE "sales_orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "sales_orders" ALTER COLUMN "status" TYPE "SalesOrderStatus"
  USING (CASE WHEN "status"::text = 'CANCELLED' THEN 'CANCELLED' ELSE 'DELIVERED' END)::"SalesOrderStatus";
ALTER TABLE "sales_orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

UPDATE "sales_orders" SET "confirmedAt" = "orderDate", "deliveredAt" = "orderDate" WHERE "status" = 'DELIVERED';
UPDATE "sales_orders" SET "cancelledAt" = "updatedAt" WHERE "status" = 'CANCELLED';
UPDATE "sales_order_items" AS i SET "deliveredQuantity" = i."quantity"
FROM "sales_orders" AS o WHERE o."id" = i."salesOrderId" AND o."status" = 'DELIVERED';
UPDATE "sales_order_items" AS i SET "releasedQuantity" = i."quantity"
FROM "sales_orders" AS o WHERE o."id" = i."salesOrderId" AND o."status" = 'CANCELLED';

INSERT INTO "sales_deliveries" ("id", "deliveryNumber", "salesOrderId", "deliveredAt", "subtotal", "discount", "tax", "total", "cogs", "notes", "userId", "createdAt")
SELECT 'sd_' || o."id",
       'DN-' || lpad((row_number() OVER (ORDER BY o."orderDate", o."orderNumber"))::text, 6, '0'),
       o."id", o."orderDate", o."subtotal", o."discount", o."tax", o."total",
       COALESCE((SELECT sum(round(i."unitCost" * i."quantity", 2)) FROM "sales_order_items" i WHERE i."salesOrderId" = o."id"), 0),
       'Delivered at sale (before stock reservations)', o."userId", now()
FROM "sales_orders" o WHERE o."status" = 'DELIVERED';

-- Line shares of the order discount and tax (by line amount, cumulative
-- rounding so the lines add up exactly to the order).
INSERT INTO "sales_delivery_items" ("id", "deliveryId", "salesOrderItemId", "productId", "quantity", "amount", "discount", "tax", "unitCost", "cogs")
SELECT 'sdi_' || x."id", 'sd_' || x."salesOrderId", x."id", x."productId", x."quantity", x."subtotal",
       x.disc_cum - COALESCE(lag(x.disc_cum) OVER w, 0),
       x.tax_cum - COALESCE(lag(x.tax_cum) OVER w, 0),
       x."unitCost", round(x."unitCost" * x."quantity", 2)
FROM (
  SELECT i.*,
         CASE WHEN o."subtotal" = 0 THEN 0
              ELSE round(o."discount" * sum(i."subtotal") OVER (PARTITION BY i."salesOrderId" ORDER BY i."id") / o."subtotal", 2) END AS disc_cum,
         CASE WHEN o."subtotal" = 0 THEN 0
              ELSE round(o."tax" * sum(i."subtotal") OVER (PARTITION BY i."salesOrderId" ORDER BY i."id") / o."subtotal", 2) END AS tax_cum
  FROM "sales_order_items" i JOIN "sales_orders" o ON o."id" = i."salesOrderId"
  WHERE o."status" = 'DELIVERED'
) AS x
WINDOW w AS (PARTITION BY x."salesOrderId" ORDER BY x."id");

-- Delivered / released can never exceed the ordered quantity.
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_fulfilment_valid"
  CHECK ("deliveredQuantity" >= 0 AND "releasedQuantity" >= 0 AND "deliveredQuantity" + "releasedQuantity" <= "quantity");
ALTER TABLE "sales_delivery_items" ADD CONSTRAINT "sales_delivery_items_quantity_positive" CHECK ("quantity" > 0);

-- Reservation expiry in days (Settings, ADMIN).
INSERT INTO "settings" ("id", "key", "value", "createdAt", "updatedAt")
VALUES ('setting_salesReservationDays', 'salesReservationDays', '7', now(), now())
ON CONFLICT ("key") DO NOTHING;

-- Permissions for the new modules (generated from DEFAULT_PERMISSIONS).
INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES
  ('rp_warehouse_manager_sales_confirm', 'WAREHOUSE_MANAGER', 'sales_confirm', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_sales_deliver', 'WAREHOUSE_MANAGER', 'sales_deliver', true, true, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_sales_reservations', 'WAREHOUSE_MANAGER', 'sales_reservations', true, false, true, true, 'ALL', NULL, now()),
  ('rp_sales_manager_sales_confirm', 'SALES_MANAGER', 'sales_confirm', true, true, false, true, 'ALL', NULL, now()),
  ('rp_sales_manager_sales_deliver', 'SALES_MANAGER', 'sales_deliver', true, true, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_sales_reservations', 'SALES_MANAGER', 'sales_reservations', true, false, true, true, 'ALL', NULL, now()),
  ('rp_sales_officer_sales_confirm', 'SALES_OFFICER', 'sales_confirm', true, true, false, true, 'OWN', NULL, now()),
  ('rp_sales_officer_sales_deliver', 'SALES_OFFICER', 'sales_deliver', true, true, false, false, 'OWN', NULL, now()),
  ('rp_sales_officer_sales_reservations', 'SALES_OFFICER', 'sales_reservations', true, false, false, false, 'OWN', NULL, now()),
  ('rp_accountant_sales_confirm', 'ACCOUNTANT', 'sales_confirm', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_sales_deliver', 'ACCOUNTANT', 'sales_deliver', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_sales_reservations', 'ACCOUNTANT', 'sales_reservations', false, false, false, false, 'ALL', NULL, now()),
  ('rp_student_sales_confirm', 'STUDENT', 'sales_confirm', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_sales_deliver', 'STUDENT', 'sales_deliver', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_sales_reservations', 'STUDENT', 'sales_reservations', true, true, true, true, 'OWN', NULL, now())
ON CONFLICT ("role", "module") DO NOTHING;

-- Read-only reconciliation of sales stock reservations (Task 8).
--   stock.reservedQuantity must equal, per product x warehouse, the units
--   still reserved by open sales orders (CONFIRMED / PARTIALLY_DELIVERED):
--   SUM(quantity - deliveredQuantity - releasedQuantity).
-- Also checks: no negative / over-reserved stock, no delivered or released
-- units beyond the ordered quantity, and delivery lines = order lines.
-- Every query only reads; the session is put in a READ ONLY transaction.
SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Reserved stock vs open sales orders (mismatches only) =='
WITH expected AS (
  SELECT i."productId", o."warehouseId",
         SUM(i."quantity" - i."deliveredQuantity" - i."releasedQuantity") AS units
  FROM "sales_order_items" i JOIN "sales_orders" o ON o."id" = i."salesOrderId"
  WHERE o."status" IN ('CONFIRMED', 'PARTIALLY_DELIVERED')
  GROUP BY 1, 2
)
SELECT p."sku", w."name" AS warehouse, COALESCE(s."reservedQuantity", 0) AS reserved_in_stock,
       COALESCE(e.units, 0) AS reserved_by_orders
FROM "stock" s
FULL JOIN expected e ON e."productId" = s."productId" AND e."warehouseId" = s."warehouseId"
LEFT JOIN "products" p ON p."id" = COALESCE(s."productId", e."productId")
LEFT JOIN "warehouses" w ON w."id" = COALESCE(s."warehouseId", e."warehouseId")
WHERE COALESCE(s."reservedQuantity", 0) <> COALESCE(e.units, 0)
ORDER BY 1, 2;

\echo '== 2. Stock rows with invalid quantities (must be empty) =='
SELECT "id", "quantity", "reservedQuantity" FROM "stock"
WHERE "quantity" < 0 OR "reservedQuantity" < 0 OR "reservedQuantity" > "quantity";

\echo '== 3. Order lines: delivered = sum of delivery lines (mismatches only) =='
SELECT o."orderNumber", i."id" AS item, i."deliveredQuantity", COALESCE(SUM(di."quantity"), 0) AS delivery_lines
FROM "sales_order_items" i
JOIN "sales_orders" o ON o."id" = i."salesOrderId"
LEFT JOIN "sales_delivery_items" di ON di."salesOrderItemId" = i."id"
GROUP BY o."orderNumber", i."id", i."deliveredQuantity"
HAVING i."deliveredQuantity" <> COALESCE(SUM(di."quantity"), 0);

\echo '== 4. Status consistency (mismatches only) =='
SELECT o."orderNumber", o."status",
       SUM(i."quantity") AS ordered, SUM(i."deliveredQuantity") AS delivered, SUM(i."releasedQuantity") AS released
FROM "sales_orders" o JOIN "sales_order_items" i ON i."salesOrderId" = o."id"
GROUP BY o."id", o."orderNumber", o."status"
HAVING (o."status" = 'DRAFT' AND (SUM(i."deliveredQuantity") > 0 OR SUM(i."releasedQuantity") > 0))
    OR (o."status" = 'DELIVERED' AND SUM(i."quantity") <> SUM(i."deliveredQuantity") + SUM(i."releasedQuantity"))
    OR (o."status" = 'CANCELLED' AND SUM(i."deliveredQuantity") > 0)
    OR (o."status" = 'CONFIRMED' AND SUM(i."deliveredQuantity") > 0);

\echo '== 5. Summary =='
SELECT (SELECT COUNT(*) FROM "sales_orders" WHERE "status" IN ('CONFIRMED', 'PARTIALLY_DELIVERED')) AS open_orders,
       (SELECT COUNT(*) FROM "sales_orders" WHERE "status" IN ('CONFIRMED', 'PARTIALLY_DELIVERED') AND "reservedUntil" < now()) AS expired_reservations,
       (SELECT COALESCE(SUM("reservedQuantity"), 0) FROM "stock") AS reserved_units;

ROLLBACK;

-- Read-only audit of sales orders before the sales-reservations migration.
-- Lists orders by status and flags non-final orders (drafts, cancelled, ...)
-- that already deducted stock. Changes nothing: the session and the
-- transaction are both read-only, and it ends with ROLLBACK.
--
-- Run against production (from the repo root, one line):
--   ssh -i ~/.ssh/siu_vps -o IdentitiesOnly=yes root@187.124.191.23 'docker exec -i -e PGOPTIONS=--default_transaction_read_only=on siu_warehouse-db-1 sh -c psql\ -X\ -U\ \$POSTGRES_USER\ -d\ \$POSTGRES_DB\ -v\ ON_ERROR_STOP=1\ -P\ pager=off' < scripts/readonly/sales-orders-audit.sql

SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;

\echo '== 0. Session is read-only (expect: on) =='
SHOW transaction_read_only;

\echo '== 1. Sales orders by status =='
SELECT status, COUNT(*) AS orders, SUM(total) AS total_value,
       MIN("orderDate")::date AS first_order, MAX("orderDate")::date AS last_order
FROM sales_orders GROUP BY status ORDER BY status;

\echo '== 2. Stock deduction check per status (ordered units vs OUT movements) =='
WITH ordered AS (SELECT "salesOrderId" AS id, SUM(quantity) AS units FROM sales_order_items GROUP BY 1),
     outm AS (SELECT "referenceId" AS id, SUM(quantity) AS units FROM stock_movements WHERE type = 'OUT' AND "referenceId" IS NOT NULL GROUP BY 1)
SELECT so.status,
       COUNT(*) FILTER (WHERE COALESCE(m.units, 0) = o.units) AS fully_deducted,
       COUNT(*) FILTER (WHERE COALESCE(m.units, 0) = 0)       AS not_deducted,
       COUNT(*) FILTER (WHERE COALESCE(m.units, 0) NOT IN (0, o.units)) AS mismatch
FROM sales_orders so JOIN ordered o ON o.id = so.id LEFT JOIN outm m ON m.id = so.id
GROUP BY so.status ORDER BY so.status;

\echo '== 3. Every non-DELIVERED order, flagged =='
WITH ordered AS (SELECT "salesOrderId" AS id, SUM(quantity) AS units FROM sales_order_items GROUP BY 1),
     outm AS (SELECT "referenceId" AS id, SUM(quantity) AS units FROM stock_movements WHERE type = 'OUT' AND "referenceId" IS NOT NULL GROUP BY 1),
     paid AS (SELECT "salesOrderId" AS id, SUM(amount) AS amount FROM customer_payments WHERE "salesOrderId" IS NOT NULL GROUP BY 1)
SELECT so."orderNumber", so.status, so."orderDate"::date AS order_date, so.total,
       COALESCE(p.amount, 0) AS paid, o.units AS ordered_units, COALESCE(m.units, 0) AS deducted_units,
       CASE
         WHEN so.status = 'CANCELLED' AND COALESCE(m.units, 0) > 0 THEN '!! CANCELLED BUT STOCK DEDUCTED'
         WHEN so.status NOT IN ('PENDING', 'CONFIRMED', 'SHIPPED', 'CANCELLED') THEN '!! UNEXPECTED STATUS'
         WHEN COALESCE(m.units, 0) = 0 THEN 'no stock movement'
         WHEN m.units <> o.units THEN '!! MISMATCH'
         WHEN so.status = 'PENDING' THEN '!! DRAFT BUT STOCK DEDUCTED'
         ELSE 'open order, stock already deducted'
       END AS flag
FROM sales_orders so JOIN ordered o ON o.id = so.id
LEFT JOIN outm m ON m.id = so.id LEFT JOIN paid p ON p.id = so.id
WHERE so.status <> 'DELIVERED'
ORDER BY so."orderDate";

\echo '== 4. Stock rows with reserved > 0 =='
SELECT s.id, s.quantity, s."reservedQuantity", s."updatedAt"::date AS updated
FROM stock s WHERE s."reservedQuantity" > 0;

\echo '== 5. Payments by linked order status (or no order) =='
SELECT COALESCE(so.status::text, '(no order)') AS order_status, COUNT(*) AS payments, SUM(cp.amount) AS amount
FROM customer_payments cp LEFT JOIN sales_orders so ON so.id = cp."salesOrderId"
GROUP BY 1 ORDER BY 1;

ROLLBACK;

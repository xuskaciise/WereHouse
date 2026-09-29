-- Read-only list of master data (products, suppliers, customers) and exact
-- row counts per table, used to decide what to keep before a test-data reset.
-- Changes nothing: read-only session and transaction, ends with ROLLBACK.
--
-- Run against production (from the repo root, one line):
--   ssh -i ~/.ssh/siu_vps -o IdentitiesOnly=yes root@187.124.191.23 'docker exec -i -e PGOPTIONS=--default_transaction_read_only=on siu_warehouse-db-1 sh -c psql\ -X\ -U\ \$POSTGRES_USER\ -d\ \$POSTGRES_DB\ -v\ ON_ERROR_STOP=1\ -P\ pager=off' < scripts/readonly/master-data-list.sql

SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;

\echo '== 0. Session is read-only (expect: on) =='
SHOW transaction_read_only;

\echo '== 1. Row counts per table =='
SELECT 'users' AS "table", COUNT(*) AS "rows" FROM users
UNION ALL SELECT 'role_permissions', COUNT(*) FROM role_permissions
UNION ALL SELECT 'permission_change_logs', COUNT(*) FROM permission_change_logs
UNION ALL SELECT 'settings', COUNT(*) FROM settings
UNION ALL SELECT 'landed_cost_types', COUNT(*) FROM landed_cost_types
UNION ALL SELECT 'expense_categories', COUNT(*) FROM expense_categories
UNION ALL SELECT 'warehouses', COUNT(*) FROM warehouses
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'sales_orders', COUNT(*) FROM sales_orders
UNION ALL SELECT 'sales_order_items', COUNT(*) FROM sales_order_items
UNION ALL SELECT 'customer_payments', COUNT(*) FROM customer_payments
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'purchase_order_items', COUNT(*) FROM purchase_order_items
UNION ALL SELECT 'purchase_receives', COUNT(*) FROM purchase_receives
UNION ALL SELECT 'purchase_receive_items', COUNT(*) FROM purchase_receive_items
UNION ALL SELECT 'purchase_order_item_adjustments', COUNT(*) FROM purchase_order_item_adjustments
UNION ALL SELECT 'purchase_landed_costs', COUNT(*) FROM purchase_landed_costs
UNION ALL SELECT 'purchase_landed_cost_allocations', COUNT(*) FROM purchase_landed_cost_allocations
UNION ALL SELECT 'landed_cost_logs', COUNT(*) FROM landed_cost_logs
UNION ALL SELECT 'supplier_payments', COUNT(*) FROM supplier_payments
UNION ALL SELECT 'expenses', COUNT(*) FROM expenses
UNION ALL SELECT 'stock_transfers', COUNT(*) FROM stock_transfers
UNION ALL SELECT 'stock_transfer_items', COUNT(*) FROM stock_transfer_items
UNION ALL SELECT 'stock_transfer_receipts', COUNT(*) FROM stock_transfer_receipts
UNION ALL SELECT 'stock_transfer_receipt_items', COUNT(*) FROM stock_transfer_receipt_items
UNION ALL SELECT 'stock_transfer_events', COUNT(*) FROM stock_transfer_events
UNION ALL SELECT 'stock_transfer_costs', COUNT(*) FROM stock_transfer_costs
UNION ALL SELECT 'stock', COUNT(*) FROM stock
UNION ALL SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL SELECT 'inventory_valuation_entries', COUNT(*) FROM inventory_valuation_entries;

\echo '== 2. Products =='
SELECT p.sku, p.name, c.name AS category, p."createdAt"::date AS created, u.username AS created_by,
       (SELECT COALESCE(SUM(quantity), 0) FROM stock s WHERE s."productId" = p.id) AS on_hand,
       (SELECT COUNT(*) FROM purchase_order_items i WHERE i."productId" = p.id) AS purchase_lines,
       (SELECT COUNT(*) FROM sales_order_items i WHERE i."productId" = p.id) AS sales_lines
FROM products p JOIN categories c ON c.id = p."categoryId" LEFT JOIN users u ON u.id = p."userId"
ORDER BY p."createdAt";

\echo '== 3. Suppliers =='
SELECT s.name, s.type, s."createdAt"::date AS created, u.username AS created_by,
       (SELECT COUNT(*) FROM purchase_orders o WHERE o."supplierId" = s.id) AS purchase_orders,
       (SELECT COUNT(*) FROM supplier_payments sp WHERE sp."supplierId" = s.id) AS payments
FROM suppliers s LEFT JOIN users u ON u.id = s."userId"
ORDER BY s."createdAt";

\echo '== 4. Customers =='
SELECT cu.name, cu."createdAt"::date AS created, u.username AS created_by,
       (SELECT COUNT(*) FROM sales_orders o WHERE o."customerId" = cu.id) AS sales_orders,
       (SELECT COUNT(*) FROM customer_payments cp WHERE cp."customerId" = cu.id) AS payments
FROM customers cu LEFT JOIN users u ON u.id = cu."userId"
ORDER BY cu."createdAt";

ROLLBACK;

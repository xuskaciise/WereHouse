// Classification of every database table for data resets. Used by the
// Settings "Danger Zone" (app/api/admin/system-reset) and checked against
// prisma/schema.prisma by scripts/check-reset-tables.mjs (part of `npm run
// lint`): a new table must be added to exactly one of these lists.
//
// The production test-data reset (scripts/reset/reset-test-data.sql) keeps
// RESET_KEEP_TABLES too, but additionally deletes all users except one admin.

/** Configuration: never deleted by a reset. */
export const RESET_KEEP_TABLES = [
  "users",
  "role_permissions",
  "permission_change_logs",
  "settings",
  "landed_cost_types",
] as const

/** Business data (master data and transactions): deleted by a reset. */
export const RESET_DELETE_TABLES = [
  "inventory_valuation_entries",
  "landed_cost_logs",
  "purchase_landed_cost_allocations",
  "purchase_landed_costs",
  "purchase_return_items",
  "purchase_returns",
  "purchase_order_item_adjustments",
  "purchase_receive_items",
  "purchase_receives",
  "purchase_order_items",
  "purchase_orders",
  "supplier_payments",
  "sales_return_items",
  "sales_returns",
  "sales_order_events",
  "sales_delivery_items",
  "sales_deliveries",
  "sales_order_items",
  "sales_orders",
  "customer_payments",
  "stock_transfer_receipt_items",
  "stock_transfer_receipts",
  "stock_transfer_events",
  "stock_transfer_costs",
  "stock_transfer_items",
  "stock_transfers",
  "stock_movements",
  "stock",
  "expenses",
  "expense_categories",
  "products",
  "categories",
  "customers",
  "suppliers",
  "warehouses",
] as const

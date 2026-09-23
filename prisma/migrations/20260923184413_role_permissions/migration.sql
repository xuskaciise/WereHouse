-- Central role permissions (lib/permission-rules.ts): one row per role and
-- module, seeded with the defaults. ADMIN is not stored (always full access).
BEGIN;

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('ALL', 'OWN');

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "module" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "scope" "PermissionScope" NOT NULL DEFAULT 'ALL',
    "discountLimit" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_change_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "module" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_module_key" ON "role_permissions"("role", "module");

-- CreateIndex
CREATE INDEX "permission_change_logs_createdAt_idx" ON "permission_change_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "permission_change_logs" ADD CONSTRAINT "permission_change_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Default permissions (generated from DEFAULT_PERMISSIONS).
INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES
  ('rp_warehouse_manager_dashboard', 'WAREHOUSE_MANAGER', 'dashboard', true, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_warehouses', 'WAREHOUSE_MANAGER', 'warehouses', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_categories', 'WAREHOUSE_MANAGER', 'categories', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_products', 'WAREHOUSE_MANAGER', 'products', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_suppliers', 'WAREHOUSE_MANAGER', 'suppliers', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_purchases', 'WAREHOUSE_MANAGER', 'purchases', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_purchase_receive', 'WAREHOUSE_MANAGER', 'purchase_receive', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_stock', 'WAREHOUSE_MANAGER', 'stock', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_stock_movements', 'WAREHOUSE_MANAGER', 'stock_movements', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_low_stock', 'WAREHOUSE_MANAGER', 'low_stock', true, true, true, true, 'ALL', NULL, now()),
  ('rp_warehouse_manager_customers', 'WAREHOUSE_MANAGER', 'customers', true, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_sales', 'WAREHOUSE_MANAGER', 'sales', true, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_sales_discount', 'WAREHOUSE_MANAGER', 'sales_discount', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_customer_payments', 'WAREHOUSE_MANAGER', 'customer_payments', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_supplier_payments', 'WAREHOUSE_MANAGER', 'supplier_payments', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_expenses', 'WAREHOUSE_MANAGER', 'expenses', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_expense_categories', 'WAREHOUSE_MANAGER', 'expense_categories', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_reports_stock', 'WAREHOUSE_MANAGER', 'reports_stock', true, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_reports_sales', 'WAREHOUSE_MANAGER', 'reports_sales', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_reports_finance', 'WAREHOUSE_MANAGER', 'reports_finance', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_users', 'WAREHOUSE_MANAGER', 'users', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_settings', 'WAREHOUSE_MANAGER', 'settings', false, false, false, false, 'ALL', NULL, now()),
  ('rp_warehouse_manager_roles', 'WAREHOUSE_MANAGER', 'roles', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_dashboard', 'SALES_MANAGER', 'dashboard', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_warehouses', 'SALES_MANAGER', 'warehouses', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_categories', 'SALES_MANAGER', 'categories', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_products', 'SALES_MANAGER', 'products', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_suppliers', 'SALES_MANAGER', 'suppliers', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_purchases', 'SALES_MANAGER', 'purchases', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_purchase_receive', 'SALES_MANAGER', 'purchase_receive', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_stock', 'SALES_MANAGER', 'stock', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_stock_movements', 'SALES_MANAGER', 'stock_movements', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_low_stock', 'SALES_MANAGER', 'low_stock', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_customers', 'SALES_MANAGER', 'customers', true, true, true, true, 'ALL', NULL, now()),
  ('rp_sales_manager_sales', 'SALES_MANAGER', 'sales', true, true, true, true, 'ALL', NULL, now()),
  ('rp_sales_manager_sales_discount', 'SALES_MANAGER', 'sales_discount', true, true, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_customer_payments', 'SALES_MANAGER', 'customer_payments', true, true, true, true, 'ALL', NULL, now()),
  ('rp_sales_manager_supplier_payments', 'SALES_MANAGER', 'supplier_payments', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_expenses', 'SALES_MANAGER', 'expenses', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_expense_categories', 'SALES_MANAGER', 'expense_categories', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_reports_stock', 'SALES_MANAGER', 'reports_stock', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_reports_sales', 'SALES_MANAGER', 'reports_sales', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_reports_finance', 'SALES_MANAGER', 'reports_finance', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_users', 'SALES_MANAGER', 'users', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_settings', 'SALES_MANAGER', 'settings', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_roles', 'SALES_MANAGER', 'roles', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_dashboard', 'SALES_OFFICER', 'dashboard', true, false, false, false, 'OWN', NULL, now()),
  ('rp_sales_officer_warehouses', 'SALES_OFFICER', 'warehouses', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_categories', 'SALES_OFFICER', 'categories', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_products', 'SALES_OFFICER', 'products', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_suppliers', 'SALES_OFFICER', 'suppliers', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_purchases', 'SALES_OFFICER', 'purchases', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_purchase_receive', 'SALES_OFFICER', 'purchase_receive', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_stock', 'SALES_OFFICER', 'stock', true, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_stock_movements', 'SALES_OFFICER', 'stock_movements', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_low_stock', 'SALES_OFFICER', 'low_stock', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_customers', 'SALES_OFFICER', 'customers', true, true, true, true, 'ALL', NULL, now()),
  ('rp_sales_officer_sales', 'SALES_OFFICER', 'sales', true, true, true, true, 'OWN', NULL, now()),
  ('rp_sales_officer_sales_discount', 'SALES_OFFICER', 'sales_discount', true, true, false, false, 'ALL', 10, now()),
  ('rp_sales_officer_customer_payments', 'SALES_OFFICER', 'customer_payments', true, true, true, true, 'OWN', NULL, now()),
  ('rp_sales_officer_supplier_payments', 'SALES_OFFICER', 'supplier_payments', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_expenses', 'SALES_OFFICER', 'expenses', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_expense_categories', 'SALES_OFFICER', 'expense_categories', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_reports_stock', 'SALES_OFFICER', 'reports_stock', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_reports_sales', 'SALES_OFFICER', 'reports_sales', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_reports_finance', 'SALES_OFFICER', 'reports_finance', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_users', 'SALES_OFFICER', 'users', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_settings', 'SALES_OFFICER', 'settings', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_roles', 'SALES_OFFICER', 'roles', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_dashboard', 'ACCOUNTANT', 'dashboard', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_warehouses', 'ACCOUNTANT', 'warehouses', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_categories', 'ACCOUNTANT', 'categories', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_products', 'ACCOUNTANT', 'products', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_suppliers', 'ACCOUNTANT', 'suppliers', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_purchases', 'ACCOUNTANT', 'purchases', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_purchase_receive', 'ACCOUNTANT', 'purchase_receive', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_stock', 'ACCOUNTANT', 'stock', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_stock_movements', 'ACCOUNTANT', 'stock_movements', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_low_stock', 'ACCOUNTANT', 'low_stock', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_customers', 'ACCOUNTANT', 'customers', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_sales', 'ACCOUNTANT', 'sales', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_sales_discount', 'ACCOUNTANT', 'sales_discount', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_customer_payments', 'ACCOUNTANT', 'customer_payments', true, true, true, true, 'ALL', NULL, now()),
  ('rp_accountant_supplier_payments', 'ACCOUNTANT', 'supplier_payments', true, true, true, true, 'ALL', NULL, now()),
  ('rp_accountant_expenses', 'ACCOUNTANT', 'expenses', true, true, true, true, 'ALL', NULL, now()),
  ('rp_accountant_expense_categories', 'ACCOUNTANT', 'expense_categories', true, true, true, true, 'ALL', NULL, now()),
  ('rp_accountant_reports_stock', 'ACCOUNTANT', 'reports_stock', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_reports_sales', 'ACCOUNTANT', 'reports_sales', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_reports_finance', 'ACCOUNTANT', 'reports_finance', true, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_users', 'ACCOUNTANT', 'users', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_settings', 'ACCOUNTANT', 'settings', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_roles', 'ACCOUNTANT', 'roles', false, false, false, false, 'ALL', NULL, now()),
  ('rp_student_dashboard', 'STUDENT', 'dashboard', true, false, false, false, 'OWN', NULL, now()),
  ('rp_student_warehouses', 'STUDENT', 'warehouses', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_categories', 'STUDENT', 'categories', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_products', 'STUDENT', 'products', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_suppliers', 'STUDENT', 'suppliers', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_purchases', 'STUDENT', 'purchases', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_purchase_receive', 'STUDENT', 'purchase_receive', true, true, false, false, 'OWN', NULL, now()),
  ('rp_student_stock', 'STUDENT', 'stock', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_stock_movements', 'STUDENT', 'stock_movements', true, false, false, false, 'OWN', NULL, now()),
  ('rp_student_low_stock', 'STUDENT', 'low_stock', true, false, false, false, 'OWN', NULL, now()),
  ('rp_student_customers', 'STUDENT', 'customers', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_sales', 'STUDENT', 'sales', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_sales_discount', 'STUDENT', 'sales_discount', true, true, false, false, 'OWN', 10, now()),
  ('rp_student_customer_payments', 'STUDENT', 'customer_payments', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_supplier_payments', 'STUDENT', 'supplier_payments', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_expenses', 'STUDENT', 'expenses', true, true, true, true, 'OWN', NULL, now()),
  ('rp_student_expense_categories', 'STUDENT', 'expense_categories', true, false, false, false, 'ALL', NULL, now()),
  ('rp_student_reports_stock', 'STUDENT', 'reports_stock', true, false, false, false, 'OWN', NULL, now()),
  ('rp_student_reports_sales', 'STUDENT', 'reports_sales', true, false, false, false, 'OWN', NULL, now()),
  ('rp_student_reports_finance', 'STUDENT', 'reports_finance', true, false, false, false, 'OWN', NULL, now()),
  ('rp_student_users', 'STUDENT', 'users', false, false, false, false, 'OWN', NULL, now()),
  ('rp_student_settings', 'STUDENT', 'settings', true, false, false, false, 'OWN', NULL, now()),
  ('rp_student_roles', 'STUDENT', 'roles', false, false, false, false, 'OWN', NULL, now());

-- The sales discount limit moves from Settings to the roles that had it
-- (every role without unlimited discounts: sales officers and students).
UPDATE "role_permissions" SET "discountLimit" = s."value"::numeric
FROM "settings" AS s
WHERE s."key" = 'maxSalesDiscountPercent'
  AND s."value" ~ '^[0-9]+(\.[0-9]{1,2})?$' AND s."value"::numeric <= 100
  AND "role_permissions"."module" = 'sales_discount'
  AND "role_permissions"."role" IN ('SALES_OFFICER', 'STUDENT');
DELETE FROM "settings" WHERE "key" = 'maxSalesDiscountPercent';

COMMIT;

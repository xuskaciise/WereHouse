-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountGroup" AS ENUM ('CASH_AND_BANK', 'RECEIVABLE', 'INVENTORY', 'OTHER_ASSET', 'PAYABLE', 'TAX', 'OTHER_LIABILITY', 'EQUITY', 'SALES', 'SALES_RETURNS', 'OTHER_INCOME', 'COGS', 'OPERATING_EXPENSE', 'LOSS', 'OTHER_EXPENSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ValuationEntryType" ADD VALUE 'STOCK_ADJUSTMENT';
ALTER TYPE "ValuationEntryType" ADD VALUE 'OPENING_STOCK';

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "cogsAccountId" TEXT,
ADD COLUMN     "inventoryAccountId" TEXT,
ADD COLUMN     "salesAccountId" TEXT;

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cogsAccountId" TEXT,
ADD COLUMN     "inventoryAccountId" TEXT,
ADD COLUMN     "salesAccountId" TEXT;

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "group" "AccountGroup" NOT NULL,
    "systemKey" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reference" TEXT,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_systemKey_key" ON "accounts"("systemKey");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entryNumber_key" ON "journal_entries"("entryNumber");

-- CreateIndex
CREATE INDEX "journal_entries_sourceType_sourceId_idx" ON "journal_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_cogsAccountId_fkey" FOREIGN KEY ("cogsAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_cogsAccountId_fkey" FOREIGN KEY ("cogsAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Journal lines: amounts are never negative and a line is either a debit or a credit.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amount_valid"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0) AND ("debit" > 0 OR "credit" > 0));

-- Every journal entry balances (checked at commit, after all its lines exist).
CREATE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  e TEXT := COALESCE(NEW."entryId", OLD."entryId");
  d NUMERIC;
  c NUMERIC;
BEGIN
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0) INTO d, c FROM "journal_lines" WHERE "entryId" = e;
  IF d <> c THEN
    RAISE EXCEPTION 'Journal entry % does not balance (debit %, credit %)', e, d, c;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- The journal is append-only: corrections are new entries, never edits.
CREATE FUNCTION journal_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Journal entries are immutable; post a correcting entry instead';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entries_immutable" BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable();
CREATE TRIGGER "journal_lines_immutable" BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable();

-- Default chart of accounts (systemKey = used by the automatic journals).
INSERT INTO "accounts" ("id", "code", "name", "type", "group", "systemKey", "description", "updatedAt") VALUES
  ('acc_cash',           '1000', 'Cash',                                'ASSET',     'CASH_AND_BANK',     'CASH',                 'Cash payments and receipts (also "Other")', now()),
  ('acc_bank',           '1010', 'Bank',                                'ASSET',     'CASH_AND_BANK',     'BANK',                 'Bank transfer, card and cheque', now()),
  ('acc_mm_evc',         '1020', 'Mobile Money - EVC Plus',             'ASSET',     'CASH_AND_BANK',     'MM_EVC_PLUS',          NULL, now()),
  ('acc_mm_zaad',        '1021', 'Mobile Money - ZAAD',                 'ASSET',     'CASH_AND_BANK',     'MM_ZAAD',              NULL, now()),
  ('acc_mm_edahab',      '1022', 'Mobile Money - E-Dahab',              'ASSET',     'CASH_AND_BANK',     'MM_EDAHAB',            NULL, now()),
  ('acc_ar',             '1100', 'Accounts Receivable',                 'ASSET',     'RECEIVABLE',        'AR',                   'Customer balances', now()),
  ('acc_inventory',      '1200', 'Inventory',                           'ASSET',     'INVENTORY',         'INVENTORY',            'Default inventory account', now()),
  ('acc_in_transit',     '1210', 'Inventory in Transit',                'ASSET',     'INVENTORY',         'INVENTORY_IN_TRANSIT', 'Goods between warehouses', now()),
  ('acc_clearing',       '1250', 'Goods Received & Landed Cost Clearing','ASSET',    'OTHER_ASSET',       'PURCHASE_CLEARING',    'Landed / transfer costs not yet applied to stock', now()),
  ('acc_ap',             '2000', 'Accounts Payable',                    'LIABILITY', 'PAYABLE',           'AP',                   'Supplier balances for received goods and costs', now()),
  ('acc_sales_tax',      '2100', 'Sales Tax Payable',                   'LIABILITY', 'TAX',               'SALES_TAX',            NULL, now()),
  ('acc_opening_equity', '3000', 'Opening Balance Equity',              'EQUITY',    'EQUITY',            'OPENING_EQUITY',       'Opening stock and balances', now()),
  ('acc_capital',        '3100', 'Owner''s Capital',                    'EQUITY',    'EQUITY',            NULL,                   NULL, now()),
  ('acc_retained',       '3200', 'Retained Earnings',                   'EQUITY',    'EQUITY',            'RETAINED_EARNINGS',    NULL, now()),
  ('acc_sales',          '4000', 'Sales',                               'INCOME',    'SALES',             'SALES',                'Default sales account (net of discounts)', now()),
  ('acc_sales_returns',  '4100', 'Sales Returns',                       'INCOME',    'SALES_RETURNS',     'SALES_RETURNS',        'Credit notes (reduces sales)', now()),
  ('acc_purchase_disc',  '4200', 'Purchase Discounts',                  'INCOME',    'OTHER_INCOME',      'PURCHASE_DISCOUNTS',   'Discounts on purchase orders', now()),
  ('acc_cogs',           '5000', 'Cost of Goods Sold',                  'EXPENSE',   'COGS',              'COGS',                 'Default COGS account', now()),
  ('acc_losses',         '5100', 'Inventory Losses & Adjustments',      'EXPENSE',   'LOSS',              'INVENTORY_LOSSES',     'Transit losses, damaged returns, stock corrections', now()),
  ('acc_pr_diff',        '5110', 'Purchase Return Differences',         'EXPENSE',   'LOSS',              'PURCHASE_RETURN_DIFF', 'Cost not credited by the supplier on returns', now()),
  ('acc_purchase_tax',   '5200', 'Purchase Tax',                        'EXPENSE',   'OTHER_EXPENSE',     'PURCHASE_TAX',         'Tax on purchase orders', now()),
  ('acc_other_expenses', '6900', 'Other Operating Expenses',            'EXPENSE',   'OPERATING_EXPENSE', 'OTHER_EXPENSES',       'Expenses of categories without an account', now())
ON CONFLICT DO NOTHING;

-- One expense account per existing expense category (6001, 6002, ...).
INSERT INTO "accounts" ("id", "code", "name", "type", "group", "updatedAt")
SELECT 'acc_exp_' || c."id", (6000 + row_number() OVER (ORDER BY c."name"))::text, c."name", 'EXPENSE', 'OPERATING_EXPENSE', now()
FROM "expense_categories" c;
UPDATE "expense_categories" c SET "accountId" = 'acc_exp_' || c."id";

-- Permissions for the new module (generated from DEFAULT_PERMISSIONS).
INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES
  ('rp_warehouse_manager_accounting', 'WAREHOUSE_MANAGER', 'accounting', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_manager_accounting', 'SALES_MANAGER', 'accounting', false, false, false, false, 'ALL', NULL, now()),
  ('rp_sales_officer_accounting', 'SALES_OFFICER', 'accounting', false, false, false, false, 'ALL', NULL, now()),
  ('rp_accountant_accounting', 'ACCOUNTANT', 'accounting', true, false, true, false, 'ALL', NULL, now()),
  ('rp_student_accounting', 'STUDENT', 'accounting', true, false, false, false, 'OWN', NULL, now())
ON CONFLICT ("role", "module") DO NOTHING;

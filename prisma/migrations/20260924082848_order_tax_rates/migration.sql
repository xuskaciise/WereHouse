-- Tax rates come from Settings and are stored on each order (taxRate, %).
-- Existing orders keep their tax and totals exactly as they are: only their
-- rate is recorded, from their current values (8% purchases / 5% sales as
-- previously hardcoded when the stored tax matches, otherwise the actual
-- ratio). No order is recalculated.
BEGIN;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

UPDATE "purchase_orders" SET "taxRate" = CASE
  WHEN "tax" = 0 THEN 0
  WHEN abs("tax" - round("subtotal" * 0.08, 2)) <= 0.01 THEN 8
  WHEN "subtotal" > 0 THEN LEAST(100, round("tax" * 100 / "subtotal", 2))
  ELSE 0
END;

UPDATE "sales_orders" SET "taxRate" = CASE
  WHEN "tax" = 0 THEN 0
  WHEN abs("tax" - round(("subtotal" - "discount") * 0.05, 2)) <= 0.01 THEN 5
  WHEN "subtotal" - "discount" > 0 THEN LEAST(100, round("tax" * 100 / ("subtotal" - "discount"), 2))
  ELSE 0
END;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tax_rate_valid" CHECK ("taxRate" >= 0 AND "taxRate" <= 100);
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tax_rate_valid" CHECK ("taxRate" >= 0 AND "taxRate" <= 100);

-- New orders have no tax until an admin sets a rate in Settings.
INSERT INTO "settings" ("id", "key", "value", "createdAt", "updatedAt") VALUES ('setting_defaultTaxRate', 'defaultTaxRate', '0', now(), now())
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now();
INSERT INTO "settings" ("id", "key", "value", "createdAt", "updatedAt") VALUES ('setting_salesTaxRate', 'salesTaxRate', '0', now(), now())
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now();
INSERT INTO "settings" ("id", "key", "value", "createdAt", "updatedAt") VALUES ('setting_purchaseTaxRate', 'purchaseTaxRate', '0', now(), now())
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now();

-- Default currency must be a currency code (it was saved as "0").
UPDATE "settings" SET "value" = 'USD', "updatedAt" = now()
WHERE "key" = 'defaultCurrency' AND "value" NOT IN ('USD', 'SOS');

-- Settings are ADMIN-only: no other role keeps any access to the module.
UPDATE "role_permissions" SET "canView" = false, "canCreate" = false, "canEdit" = false, "canDelete" = false, "updatedAt" = now()
WHERE "module" = 'settings';

COMMIT;

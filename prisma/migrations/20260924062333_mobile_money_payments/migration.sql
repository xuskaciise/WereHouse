-- Somali mobile money payment methods (EVC Plus, ZAAD, E-Dahab): payer phone
-- and transaction ID on payments and expenses, plus the payment method
-- settings (enabled methods, operator prefixes). Existing records keep their
-- payment method.
BEGIN;

-- AlterTable
ALTER TABLE "customer_payments" ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "transactionId" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "transactionId" TEXT;

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "transactionId" TEXT;

-- Phone numbers are stored normalized as +252 followed by 9 digits.
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_payer_phone_format" CHECK ("payerPhone" IS NULL OR "payerPhone" ~ '^[+]252[0-9]{9}$');
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_payer_phone_format" CHECK ("payerPhone" IS NULL OR "payerPhone" ~ '^[+]252[0-9]{9}$');
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payer_phone_format" CHECK ("payerPhone" IS NULL OR "payerPhone" ~ '^[+]252[0-9]{9}$');

-- Default payment method settings (NCA numbering plan Sept 2024 + 77 for
-- Hormuud); ADMIN can change them in Settings.
INSERT INTO "settings" ("id", "key", "value", "createdAt", "updatedAt")
VALUES ('setting_payment_method_config', 'paymentMethodConfig', '{"disabled":[],"prefixes":{"EVC_PLUS":["61","68","77"],"ZAAD":["63","67"],"EDAHAB":["62","65","66"]}}', now(), now())
ON CONFLICT ("key") DO NOTHING;

COMMIT;

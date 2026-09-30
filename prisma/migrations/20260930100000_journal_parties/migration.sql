-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- CreateIndex
CREATE INDEX "journal_lines_supplierId_idx" ON "journal_lines"("supplierId");

-- CreateIndex
CREATE INDEX "journal_lines_customerId_idx" ON "journal_lines"("customerId");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Party of the existing Accounts Payable / Receivable lines, from their
-- source document (documents deleted since have no party; their lines net
-- to zero). The journal is append-only, so the immutability trigger is
-- switched off for this one-time backfill only.
-- Balance checks run per statement here (no pending trigger events before ENABLE).
SET CONSTRAINTS "journal_lines_balanced" IMMEDIATE;
ALTER TABLE "journal_lines" DISABLE TRIGGER "journal_lines_immutable";

UPDATE "journal_lines" l SET "supplierId" = src."supplierId"
FROM "journal_entries" e
JOIN (
  SELECT 'PURCHASE_ORDER' AS t, "id", "supplierId" FROM "purchase_orders"
  UNION ALL SELECT 'LANDED_COST', "id", "paidToSupplierId" FROM "purchase_landed_costs"
  UNION ALL SELECT 'TRANSFER_COST', "id", "paidToSupplierId" FROM "stock_transfer_costs"
  UNION ALL SELECT 'PURCHASE_RETURN', "id", "supplierId" FROM "purchase_returns"
  UNION ALL SELECT 'SUPPLIER_PAYMENT', "id", "supplierId" FROM "supplier_payments"
) src ON src.t = e."sourceType" AND src."id" = e."sourceId"
WHERE e."id" = l."entryId"
  AND l."accountId" = (SELECT "id" FROM "accounts" WHERE "systemKey" = 'AP');

UPDATE "journal_lines" l SET "customerId" = src."customerId"
FROM "journal_entries" e
JOIN (
  SELECT 'SALES_DELIVERY' AS t, d."id", o."customerId" FROM "sales_deliveries" d JOIN "sales_orders" o ON o."id" = d."salesOrderId"
  UNION ALL SELECT 'SALES_RETURN', "id", "customerId" FROM "sales_returns"
  UNION ALL SELECT 'CUSTOMER_PAYMENT', "id", "customerId" FROM "customer_payments"
) src ON src.t = e."sourceType" AND src."id" = e."sourceId"
WHERE e."id" = l."entryId"
  AND l."accountId" = (SELECT "id" FROM "accounts" WHERE "systemKey" = 'AR');

ALTER TABLE "journal_lines" ENABLE TRIGGER "journal_lines_immutable";

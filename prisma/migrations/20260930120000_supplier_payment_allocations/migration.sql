-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "landedCostId" TEXT,
    "stockTransferCostId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_paymentId_idx" ON "supplier_payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_landedCostId_idx" ON "supplier_payment_allocations"("landedCostId");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_stockTransferCostId_idx" ON "supplier_payment_allocations"("stockTransferCostId");

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "purchase_landed_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_stockTransferCostId_fkey" FOREIGN KEY ("stockTransferCostId") REFERENCES "stock_transfer_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one cost line per allocation; amounts are positive.
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_one_cost"
  CHECK ((("landedCostId" IS NOT NULL)::int + ("stockTransferCostId" IS NOT NULL)::int) = 1);
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_amount_positive"
  CHECK ("amount" > 0);

-- Backfill: every existing payment linked to one cost line settles that line
-- with its full amount (the paid status of existing lines stays the same).
INSERT INTO "supplier_payment_allocations" ("id", "paymentId", "landedCostId", "stockTransferCostId", "amount", "createdAt")
SELECT 'spa_' || p."id", p."id", p."landedCostId", NULL, p."amount", p."createdAt"
FROM "supplier_payments" p
WHERE p."landedCostId" IS NOT NULL AND p."amount" > 0;

INSERT INTO "supplier_payment_allocations" ("id", "paymentId", "landedCostId", "stockTransferCostId", "amount", "createdAt")
SELECT 'spa_' || p."id", p."id", NULL, p."stockTransferCostId", p."amount", p."createdAt"
FROM "supplier_payments" p
WHERE p."stockTransferCostId" IS NOT NULL AND p."landedCostId" IS NULL AND p."amount" > 0;

// Supplier payable = Accounts Payable ledger; ordered-not-received shown separately (DEV database).
import { prisma, TX_OPTIONS } from "@/lib/prisma"
import { postAccounting } from "@/lib/accounting"
import { getSupplierPositions, withSupplierBalance } from "@/lib/balances"
import { Decimal } from "@/lib/money"
import type { Prisma } from "@prisma/client"
import { assertDevDatabase, check, eq, finish, fixtures, receivedPurchase, testUser } from "./helpers"

async function main() {
  assertDevDatabase()
  const tag = "tp" + Date.now().toString(36)
  const admin = await testUser("tp_admin", "ADMIN")
  const f = await fixtures(tag, admin)
  const p = await f.product("A", 20, 10)
  const pos = async () => (await getSupplierPositions([f.supplier.id])).get(f.supplier.id)!

  // Open PO, nothing received: all "ordered, not received", payable 0.
  // 10 x 10 = 100, discount 4, tax 5% = 5 -> total 101
  const po = await prisma.purchaseOrder.create({
    data: {
      orderNumber: `PO-${tag}`, supplierId: f.supplier.id, warehouseId: f.wh.id, userId: admin.id, status: "PENDING",
      subtotal: 100, discount: 4, tax: 5, taxRate: 5, total: 101,
      items: { create: [{ productId: p.id, quantity: 10, originalQuantity: 10, unitPrice: 10, subtotal: 100 }] },
    },
    include: { items: true },
  })
  let x = await pos()
  check("open PO: payable 0, ordered not received 101", eq(x.payable, 0) && eq(x.orderedNotReceived, 101), x)

  // Receive 3 of 10: payable 30 + 1.50 tax - 1.20 discount = 30.30, not received 70.70.
  const { receiveIntoStock } = await import("@/lib/stock-valuation")
  await prisma.$transaction(async (tx) => {
    await tx.purchaseReceive.create({ data: { purchaseOrderId: po.id, userId: admin.id, items: { create: [{ purchaseOrderItemId: po.items[0].id, quantityReceived: 3 }] } } })
    await receiveIntoStock(tx, { productId: p.id, warehouseId: f.wh.id, quantity: 3, value: new Decimal(30), userId: admin.id, purchaseOrderItemId: po.items[0].id })
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "PARTIALLY_RECEIVED" } })
    await postAccounting(tx, {}, admin.id)
  }, TX_OPTIONS)
  x = await pos()
  check("partial: payable 30.30", eq(x.payable, "30.3"), x)
  check("partial: ordered not received 70.70", eq(x.orderedNotReceived, "70.7"), x)
  check("payable + not received = order total", eq(x.payable.plus(x.orderedNotReceived), 101))

  // Advance payment before the rest arrives: payable goes negative (prepaid), order unchanged.
  await prisma.$transaction(async (tx) => {
    await tx.supplierPayment.create({ data: { supplierId: f.supplier.id, amount: 50, paymentMethod: "CASH", userId: admin.id } })
    await postAccounting(tx, {}, admin.id)
  }, TX_OPTIONS)
  x = await pos()
  check("after paying 50: payable -19.70 (prepaid)", eq(x.payable, "-19.7"), x)

  // A second, fully received PO adds only to payable.
  await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO2-${tag}` }, [[p.id, 2, 10]])
  x = await pos()
  check("fully received PO: payable +20 = 0.30, not received unchanged", eq(x.payable, "0.3") && eq(x.orderedNotReceived, "70.7"), x)

  // Payable is exactly the supplier's lines on the AP account.
  const ap = await prisma.$queryRaw<{ n: Prisma.Decimal }[]>`
    SELECT COALESCE(SUM(l."credit" - l."debit"), 0) AS n FROM "journal_lines" l JOIN "accounts" a ON a."id" = l."accountId"
    WHERE a."systemKey" = 'AP' AND l."supplierId" = ${f.supplier.id}`
  check("payable = supplier's Accounts Payable lines", eq(ap[0].n, x.payable), [ap[0].n, x.payable])

  // Across all suppliers: sum of payables + lines without a supplier = AP account balance.
  const totals = await prisma.$queryRaw<{ total: Prisma.Decimal; unassigned: Prisma.Decimal }[]>`
    SELECT COALESCE(SUM(l."credit" - l."debit"), 0) AS total,
           COALESCE(SUM(l."credit" - l."debit") FILTER (WHERE l."supplierId" IS NULL), 0) AS unassigned
    FROM "journal_lines" l JOIN "accounts" a ON a."id" = l."accountId" WHERE a."systemKey" = 'AP'`
  const allSuppliers = await prisma.supplier.findMany({ select: { id: true } })
  const withBal = await withSupplierBalance(allSuppliers)
  const sum = withBal.reduce((s, r) => s.plus(r.payable), new Decimal(0))
  check("sum of supplier payables + unassigned = Accounts Payable", eq(sum.plus(totals[0].unassigned), totals[0].total), [sum, totals[0]])
  check("unassigned AP lines net to zero (deleted documents only)", eq(totals[0].unassigned, 0), totals[0].unassigned)
  finish()
}

main().finally(() => prisma.$disconnect())

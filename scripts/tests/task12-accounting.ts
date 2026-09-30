// Task 12 integration test (automatic double-entry journal) on the DEV database.
// Run AFTER the other task tests: it checks the whole dev ledger.
import { prisma } from "@/lib/prisma"
import { inventoryReconciliation, postAccounting, syncAllJournals, unsyncedCount } from "@/lib/accounting"
import { trialBalance, listAccounts, createExpenseAccountFor } from "@/lib/accounts"
import { getCustomerBalances, getSupplierBalances } from "@/lib/balances"
import { createSalesOrder, deliverSalesOrder } from "@/lib/sales-orders"
import { createSalesReturn } from "@/lib/sales-returns"
import { createPurchaseReturn } from "@/lib/purchase-returns"
import { Decimal } from "@/lib/money"
import type { Prisma } from "@prisma/client"
type Decimal = Prisma.Decimal
import { TX_OPTIONS } from "@/lib/prisma"
import { assertDevDatabase, check, eq, finish, fixtures, receivedPurchase, testUser } from "./helpers"

const sysId = async (key: string) => (await prisma.account.findUniqueOrThrow({ where: { systemKey: key } })).id
async function balance(accountId: string, sourceType?: string, sourceId?: string) {
  const r = await prisma.$queryRaw<{ net: Decimal | null }[]>`
    SELECT SUM(l."debit" - l."credit") AS net FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
    WHERE l."accountId" = ${accountId} AND (${sourceType ?? null}::text IS NULL OR e."sourceType" = ${sourceType ?? null})
      AND (${sourceId ?? null}::text IS NULL OR e."sourceId" = ${sourceId ?? null})`
  return new Decimal(r[0]?.net ?? 0)
}
const docNet = async (type: string, id: string) =>
  prisma.$queryRaw<{ accountId: string; net: Decimal }[]>`
    SELECT l."accountId", SUM(l."debit" - l."credit") AS net FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
    WHERE e."sourceType" = ${type} AND e."sourceId" = ${id} GROUP BY 1 HAVING SUM(l."debit" - l."credit") <> 0`

async function main() {
  assertDevDatabase()
  const admin = await testUser("t12_admin", "ADMIN")

  // 1. Backfill everything that exists on dev, then it must be idempotent.
  const first = await syncAllJournals(prisma as any, admin.id)
  console.log("backfill:", first)
  const again = await syncAllJournals(prisma as any, admin.id)
  check("backfill is idempotent (second run posts nothing)", again.posted === 0 && !again.openingBalance, again)
  check("no document without a journal", (await prisma.$transaction((tx) => unsyncedCount(tx))).missing === 0)

  let tb = await trialBalance(admin, null, null)
  check("trial balance balances", tb.balanced && tb.totalDebit.eq(tb.totalCredit), [tb.totalDebit, tb.totalCredit])
  // Earlier test fixtures on dev added stock without valuation; this run must not change the difference.
  let inv = await prisma.$transaction((tx) => inventoryReconciliation(tx))
  const diffBefore = new Map(inv.map((r) => [r.id, r.difference]))
  console.log("inventory difference before:", inv.map((r) => `${r.code} ${r.difference}`).join(", "))

  // 2. A full cycle with its own fixtures, checking each document's journal.
  const tag = "t12" + Date.now().toString(36)
  const f = await fixtures(tag, admin)
  const [AR, AP, SALES, COGS, INV, TAX, CASH, EVC, CLEAR, RET, LOSS, PTAX, PDISC] = await Promise.all(
    ["AR", "AP", "SALES", "COGS", "INVENTORY", "SALES_TAX", "CASH", "MM_EVC_PLUS", "PURCHASE_CLEARING", "SALES_RETURNS", "INVENTORY_LOSSES", "PURCHASE_TAX", "PURCHASE_DISCOUNTS"].map(sysId)
  )
  const p = await f.product("A", 30, 10)
  // Category with its own sales account: the delivery must use it.
  const catSales = await prisma.account.create({ data: { code: String(40000 + Math.floor(Math.random() * 9999)), name: `Sales ${tag}`, type: "INCOME", group: "SALES" } })
  await prisma.category.update({ where: { id: f.cat.id }, data: { salesAccountId: catSales.id } })

  const po = await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}` }, [[p.id, 10, 10]], { discount: 5, taxRate: 10 })
  // The test helper bypasses the receive route, so post its documents explicitly.
  const receiptEntries = await prisma.inventoryValuationEntry.findMany({ where: { purchaseOrderItemId: { in: po.items.map((i) => i.id) } }, select: { id: true } })
  await prisma.$transaction(async (tx) => {
    await postAccounting(tx, { PURCHASE_ORDER: [po.id], VALUATION: receiptEntries.map((e) => e.id) }, admin.id)
  }, TX_OPTIONS)
  const poNet = new Map((await docNet("PURCHASE_ORDER", po.id)).map((r) => [r.accountId, new Decimal(r.net)]))
  check("receipt: AP credited 100 + 10 tax - 5 discount = 105", eq(poNet.get(AP)!, -105), [...poNet])
  check("receipt: purchase tax 10, discount 5", eq(poNet.get(PTAX)!, 10) && eq(poNet.get(PDISC)!, -5))

  const orderId = await createSalesOrder(admin, {
    customerId: f.customer.id, warehouseId: f.wh.id, mode: "sell_now",
    items: [{ productId: p.id, quantity: 4, unitPrice: 30 }],
  })
  const delivery = await prisma.salesDelivery.findFirstOrThrow({ where: { salesOrderId: orderId } })
  const dNet = new Map((await docNet("SALES_DELIVERY", delivery.id)).map((r) => [r.accountId, new Decimal(r.net)]))
  check("delivery: AR debited with the total", eq(dNet.get(AR)!, delivery.total), [...dNet])
  check("delivery: category sales account credited 120", eq(dNet.get(catSales.id)!, -120) && !dNet.has(SALES))
  check("delivery: COGS 40 / inventory -40", eq(dNet.get(COGS)!, 40) && eq(dNet.get(INV)!, -40))
  check("delivery: sales tax payable", eq(dNet.get(TAX) ?? 0, delivery.tax.neg()))

  // Customer payment by EVC: cash account per method; edit and delete post corrections.
  const pay = await prisma.$transaction(async (tx) => {
    const cp = await tx.customerPayment.create({ data: { customerId: f.customer.id, amount: 50, paymentMethod: "EVC_PLUS", payerPhone: "+252615000000", userId: admin.id } })
    await postAccounting(tx, {}, admin.id)
    return cp
  }, TX_OPTIONS)
  check("payment: EVC Plus account debited 50", eq(await balance(EVC, "CUSTOMER_PAYMENT", pay.id), 50))
  await prisma.$transaction(async (tx) => {
    await tx.customerPayment.update({ where: { id: pay.id }, data: { amount: 70, paymentMethod: "CASH", payerPhone: null } })
    await postAccounting(tx, {}, admin.id)
  }, TX_OPTIONS)
  check("payment edit: EVC reversed, cash 70", eq(await balance(EVC, "CUSTOMER_PAYMENT", pay.id), 0) && eq(await balance(CASH, "CUSTOMER_PAYMENT", pay.id), 70))
  const corrections = await prisma.journalEntry.count({ where: { sourceType: "CUSTOMER_PAYMENT", sourceId: pay.id, isAdjustment: true } })
  check("the edit is a separate correcting entry", corrections === 1, corrections)
  await prisma.$transaction(async (tx) => {
    await tx.customerPayment.delete({ where: { id: pay.id } })
    await postAccounting(tx, { CUSTOMER_PAYMENT: [pay.id] }, admin.id)
  }, TX_OPTIONS)
  check("payment delete: fully reversed", (await docNet("CUSTOMER_PAYMENT", pay.id)).length === 0)

  // Returns.
  const item = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: orderId } })
  const sr = await createSalesReturn(admin, { salesOrderId: orderId, reason: "t12", lines: [{ itemId: item.id, quantity: 1, condition: "RESELLABLE" }, { itemId: item.id, quantity: 1, condition: "DAMAGED" }] })
  const srNet = new Map((await docNet("SALES_RETURN", sr)).map((r) => [r.accountId, new Decimal(r.net)]))
  check("sales return: sales returns 60, inventory +10, loss +10, COGS -20", eq(srNet.get(RET)!, 60) && eq(srNet.get(INV)!, 10) && eq(srNet.get(LOSS)!, 10) && eq(srNet.get(COGS)!, -20), [...srNet])
  const poItem = po.items[0]
  const pr = await createPurchaseReturn(admin, { purchaseOrderId: po.id, reason: "t12", lines: [{ itemId: poItem.id, quantity: 2 }] })
  check("purchase return journal balances and credits inventory 20", eq((await docNet("PURCHASE_RETURN", pr)).find((r) => r.accountId === INV)?.net ?? 0, -20))

  // Expense in a new category: its own expense account.
  const ec = await prisma.expenseCategory.create({ data: { name: `Rent ${tag}`, nameKey: `rent ${tag}` } })
  await prisma.$transaction((tx) => createExpenseAccountFor(tx, ec.id, ec.name), TX_OPTIONS)
  const ecAccount = (await prisma.expenseCategory.findUniqueOrThrow({ where: { id: ec.id } })).accountId!
  const ex = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.create({ data: { categoryId: ec.id, amount: "12.34", description: "t12", paymentMethod: "ZAAD", payerPhone: "+252634000000", userId: admin.id } })
    await postAccounting(tx, {}, admin.id)
    return e
  }, TX_OPTIONS)
  check("expense on its category account", eq(await balance(ecAccount, "EXPENSE", ex.id), "12.34"))

  // Stock adjustment valued at average cost.
  const { recordStockValueChange } = await import("@/lib/stock-valuation")
  const { decrementStock } = await import("@/lib/stock")
  await prisma.$transaction(async (tx) => {
    await decrementStock(tx, { productId: p.id, warehouseId: f.wh.id, quantity: 1 })
    await recordStockValueChange(tx, { productId: p.id, warehouseId: f.wh.id, delta: -1, userId: admin.id })
    await postAccounting(tx, {}, admin.id)
  }, TX_OPTIONS)

  // 3. Whole ledger still consistent.
  tb = await trialBalance(admin, null, null)
  check("trial balance still balances", tb.balanced, [tb.totalDebit, tb.totalCredit])
  inv = await prisma.$transaction((tx) => inventoryReconciliation(tx))
  check("this cycle kept inventory accounts = stock value (difference unchanged)", inv.every((r) => r.difference.minus(diffBefore.get(r.id) ?? 0).abs().lte("0.05")), inv)
  const custBal = (await getCustomerBalances([f.customer.id])).get(f.customer.id)!
  const arForCustomer = await prisma.$queryRaw<{ net: Decimal }[]>`
    SELECT COALESCE(SUM(l."debit" - l."credit"), 0) AS net FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
    WHERE l."accountId" = ${AR} AND (
      (e."sourceType" = 'SALES_DELIVERY' AND e."sourceId" IN (SELECT "id" FROM "sales_deliveries" WHERE "salesOrderId" = ${orderId}))
      OR (e."sourceType" = 'SALES_RETURN' AND e."sourceId" = ${sr}))`
  check("AR of this customer = customer balance", eq(arForCustomer[0].net, custBal), [arForCustomer[0].net, custBal])
  const supBal = (await getSupplierBalances([f.supplier.id])).get(f.supplier.id)!
  const apNet = (await balance(AP, "PURCHASE_ORDER", po.id)).plus(await balance(AP, "PURCHASE_RETURN", pr))
  check("AP of this supplier = supplier balance (fully received PO)", eq(apNet.neg(), supBal), [apNet, supBal])
  check("clearing of this PO is zero", eq((await balance(CLEAR, "PURCHASE_ORDER", po.id)).plus(await prisma.$queryRaw<{ n: Decimal }[]>`
    SELECT COALESCE(SUM(l."debit" - l."credit"), 0) AS n FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
    JOIN "inventory_valuation_entries" v ON v."id" = e."sourceId" AND e."sourceType" = 'VALUATION'
    WHERE l."accountId" = ${CLEAR} AND v."purchaseOrderItemId" = ${poItem.id} AND v."type" = 'RECEIPT'`.then((r) => new Decimal(r[0].n))), 0))

  const accounts = await listAccounts(admin)
  check("chart has the system accounts", ["CASH", "AR", "INVENTORY", "AP", "SALES", "SALES_RETURNS", "COGS", "INVENTORY_LOSSES"].every((k) => accounts.some((a) => a.systemKey === k)))

  // 4. The database refuses an unbalanced entry and edits of posted lines.
  let refused = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.create({ data: { entryNumber: `JE-T${Date.now()}`, date: new Date(), description: "bad", sourceType: "TEST", sourceId: "x", lines: { create: [{ accountId: CASH, debit: 1 }] } } })
      await tx.$executeRaw`SET CONSTRAINTS "journal_lines_balanced" IMMEDIATE` // as postAccounting does
    })
  } catch {
    refused = true
  }
  check("unbalanced entry refused by the database", refused)
  refused = false
  try {
    await prisma.journalLine.updateMany({ where: { accountId: CASH }, data: { memo: "x" } })
  } catch {
    refused = true
  }
  check("posted lines cannot be edited", refused)
  finish()
}

main().finally(() => prisma.$disconnect())

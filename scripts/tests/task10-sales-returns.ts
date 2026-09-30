// Task 10 integration test (sales returns / credit notes) on the DEV database.
import { prisma } from "@/lib/prisma"
import { createSalesOrder, salesOrderDetail } from "@/lib/sales-orders"
import { createSalesReturn, returnableSalesLines, salesReturnDetail } from "@/lib/sales-returns"
import { getCustomerBalances } from "@/lib/balances"
import { salesProfit } from "@/lib/profit"
import { Decimal } from "@/lib/money"
import { assertDevDatabase, check, eq, expectError, finish, fixtures, receivedPurchase, testUser } from "./helpers"

async function main() {
  assertDevDatabase()
  const tag = "t10" + Date.now().toString(36)
  const admin = await testUser("t10_admin", "ADMIN")
  const officer = await testUser("t10_officer", "SALES_OFFICER")
  const f = await fixtures(tag, admin)
  const pA = await f.product("A", 25, 10)
  const pB = await f.product("B", 12, 5)
  await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}` }, [[pA.id, 20, 10], [pB.id, 10, 5]])

  const taxBefore = await prisma.setting.findUnique({ where: { key: "salesTaxRate" } })
  await prisma.setting.upsert({ where: { key: "salesTaxRate" }, update: { value: "5" }, create: { key: "salesTaxRate", value: "5" } })
  const start = new Date()
  try {
    // Sell now: A 4 x 25 - 10% = 90.00, B 2 x 12 = 24.00 -> 114.00; order discount 5.00; tax 5% of 109 = 5.45 -> 114.45
    const orderId = await createSalesOrder(admin, {
      customerId: f.customer.id,
      warehouseId: f.wh.id,
      mode: "sell_now",
      items: [
        { productId: pA.id, quantity: 4, unitPrice: 25, discount: { type: "PERCENT", value: 10 } },
        { productId: pB.id, quantity: 2, unitPrice: 12 },
      ],
      discount: { type: "AMOUNT", value: "5" },
      discountReason: "Loyal customer",
    })
    const order = await salesOrderDetail(admin, orderId)
    check("order total 114.45", eq(order.total, "114.45"), order.total)
    const iA = order.items.find((i) => i.productId === pA.id)!
    const iB = order.items.find((i) => i.productId === pB.id)!
    let bal = (await getCustomerBalances([f.customer.id])).get(f.customer.id)!
    check("customer owes 114.45", eq(bal, "114.45"), bal)

    // A new receipt at 16 changes the average; returns must still use the original cost 10.
    await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO2-${tag}` }, [[pA.id, 16, 16]])
    let s = await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId: pA.id, warehouseId: f.wh.id } } })
    check("avg A after new receipt = (16x10 + 16x16)/32 = 13", eq(s.avgCost, 13) && s.quantity === 32, s)

    const r = await returnableSalesLines(admin, orderId)
    check("returnable A 4", r.lines.find((l) => l.itemId === iA.id)?.returnable === 4, r.lines)
    await expectError("reason required", () => createSalesReturn(admin, { salesOrderId: orderId, lines: [{ itemId: iA.id, quantity: 1, condition: "RESELLABLE" }] }), 400)
    await expectError("condition required", () => createSalesReturn(admin, { salesOrderId: orderId, lines: [{ itemId: iA.id, quantity: 1 }], reason: "x" }), 400)
    await expectError("cannot return more than delivered", () => createSalesReturn(admin, { salesOrderId: orderId, lines: [{ itemId: iA.id, quantity: 5, condition: "RESELLABLE" }], reason: "x" }), 400)
    await expectError("officer (OWN) cannot return another user's order", () => createSalesReturn(officer, { salesOrderId: orderId, lines: [{ itemId: iA.id, quantity: 1, condition: "RESELLABLE" }], reason: "x" }), 404)

    // Return A: 2 resellable + 1 damaged.
    // amount: cumulative 90 x 3/4 = 67.50; discount 5 x 67.50/114 = 2.96; tax 5.45 x 67.50/114 = 3.23 -> 67.77
    const id1 = await createSalesReturn(admin, {
      salesOrderId: orderId,
      lines: [
        { itemId: iA.id, quantity: 2, condition: "RESELLABLE" },
        { itemId: iA.id, quantity: 1, condition: "DAMAGED" },
      ],
      reason: "Wrong colour; one broken",
    })
    const r1 = await salesReturnDetail(admin, id1)
    check("number SR-", /^SR-\d{6}$/.test(r1.returnNumber), r1.returnNumber)
    check("subtotal 67.50", eq(r1.subtotal, "67.5"), r1.subtotal)
    check("discount share 2.96", eq(r1.discount, "2.96"), r1.discount)
    check("tax share 3.23", eq(r1.tax, "3.23"), r1.tax)
    check("credit note 67.77", eq(r1.total, "67.77"), r1.total)
    check("cogs at original cost 3 x 10 = 30", eq(r1.cogs!, 30), r1.cogs)
    check("loss = damaged 1 x 10", eq(r1.lossValue!, 10), r1.lossValue)
    check("lines split by condition add up", eq(r1.items.reduce((sum, i) => sum.plus(i.amount), new Decimal(0)), "67.5"), r1.items)
    s = await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId: pA.id, warehouseId: f.wh.id } } })
    check("stock A +2 only (damaged not restocked): 34", s.quantity === 34, s.quantity)
    check("avg A = (32 x 13 + 2 x 10) / 34 = 12.8235", eq(s.avgCost, "12.8235"), s.avgCost)
    const loss = await prisma.inventoryValuationEntry.findMany({ where: { type: "SALES_RETURN_LOSS", productId: pA.id } })
    check("loss entry 10.00", loss.length === 1 && eq(loss[0].amount, 10), loss)
    bal = (await getCustomerBalances([f.customer.id])).get(f.customer.id)!
    check("customer owes 114.45 - 67.77 = 46.68", eq(bal, "46.68"), bal)

    // Return the rest with a ZAAD refund: the returns must add up to the order exactly.
    await expectError("refund above the credit note", () => createSalesReturn(admin, {
      salesOrderId: orderId,
      lines: [{ itemId: iA.id, quantity: 1, condition: "RESELLABLE" }, { itemId: iB.id, quantity: 2, condition: "RESELLABLE" }],
      reason: "Rest",
      refund: { amount: "999", paymentMethod: "ZAAD", payerPhone: "634123456" },
    }), 400)
    const id2 = await createSalesReturn(admin, {
      salesOrderId: orderId,
      lines: [{ itemId: iA.id, quantity: 1, condition: "RESELLABLE" }, { itemId: iB.id, quantity: 2, condition: "RESELLABLE" }],
      reason: "Rest",
      refund: { amount: "46.68", paymentMethod: "ZAAD", payerPhone: "634123456" },
    })
    const r2 = await salesReturnDetail(admin, id2)
    check("both credit notes = order total", eq(new Decimal(r1.total).plus(r2.total), order.total), [r1.total, r2.total])
    check("refund stored (ZAAD)", r2.refundMethod === "ZAAD" && eq(r2.refundAmount, "46.68"), r2)
    bal = (await getCustomerBalances([f.customer.id])).get(f.customer.id)!
    check("customer balance after full return + refund: 114.45 - 114.45 + 46.68 = 46.68", eq(bal, "46.68"), bal)
    await expectError("nothing left to return", () => createSalesReturn(admin, { salesOrderId: orderId, lines: [{ itemId: iB.id, quantity: 1, condition: "RESELLABLE" }], reason: "x" }), 400)

    const detail = await salesOrderDetail(admin, orderId)
    check("order shows returned quantities", detail.items.every((i) => i.returnedQuantity === i.deliveredQuantity), detail.items)
    check("order has a RETURNED event", detail.events.filter((e) => e.type === "RETURNED").length === 2, detail.events.map((e) => e.type))

    // Profit over the period: fully returned -> revenue 0, COGS 0; loss 10 reported separately.
    const p = await salesProfit({ where: { id: orderId }, adjustmentWhere: { productId: { in: [pA.id, pB.id] } }, from: start, includeLosses: true })
    const row = p.orders.find((o) => o.id === orderId)!
    check("profit: revenue 0 after full return", eq(row.revenue, 0), row.revenue)
    check("profit: COGS 0 after full return", eq(row.cogs, 0), row.cogs)
    check("losses include the damaged unit (10)", eq(p.totals.stockLosses!, 10), p.totals.stockLosses)
  } finally {
    if (taxBefore) await prisma.setting.update({ where: { key: "salesTaxRate" }, data: { value: taxBefore.value } })
    else await prisma.setting.delete({ where: { key: "salesTaxRate" } })
  }
  finish()
}

main().finally(() => prisma.$disconnect())

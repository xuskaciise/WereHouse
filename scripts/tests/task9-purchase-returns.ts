// Task 9 integration test (purchase returns) on the DEV database.
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/permissions"
import { createPurchaseReturn, purchaseReturnDetail, returnableLines } from "@/lib/purchase-returns"
import { createSalesOrder } from "@/lib/sales-orders"
import { getSupplierBalances } from "@/lib/balances"
import { assertDevDatabase, check, eq, expectError, finish, fixtures, receivedPurchase, testUser } from "./helpers"

async function main() {
  assertDevDatabase()
  const tag = "t9" + Date.now().toString(36)
  const admin = await testUser("t9_admin", "ADMIN")
  const wm = await testUser("t9_wm", "WAREHOUSE_MANAGER")
  const accountant = await testUser("t9_acc", "ACCOUNTANT")
  const f = await fixtures(tag, admin)
  const pA = await f.product("A", 20, 10)
  const pB = await f.product("B", 9, 4)

  // PO: A 10 x 10.00, B 5 x 4.00 = 120.00; discount 12.00, tax 5% = 6.00 -> total 114.00
  const po = await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}` }, [[pA.id, 10, 10], [pB.id, 5, 4]], { discount: 12, taxRate: 5 })
  const iA = po.items.find((i) => i.productId === pA.id)!
  const iB = po.items.find((i) => i.productId === pB.id)!
  let bal = (await getSupplierBalances([f.supplier.id])).get(f.supplier.id)!
  check("supplier balance = PO total 114.00", eq(bal, "114"), bal)

  const r = await returnableLines(admin, po.id)
  check("returnable A 10", r.lines.find((l) => l.itemId === iA.id)?.returnable === 10, r.lines)

  await expectError("reason required", () => createPurchaseReturn(admin, { purchaseOrderId: po.id, lines: [{ itemId: iA.id, quantity: 1 }] }), 400)
  await expectError("cannot return more than received", () => createPurchaseReturn(admin, { purchaseOrderId: po.id, lines: [{ itemId: iA.id, quantity: 11 }], reason: "x" }), 400)
  await expectError("accountant cannot create (view only)", async () => requirePermission(accountant, ["purchase_returns", "create"]), 403)

  // Return 4 x A: goods 40.00, discount share 12 x 40/120 = 4.00, tax 6 x 40/120 = 2.00 -> credit 38.00
  const id1 = await createPurchaseReturn(wm, { purchaseOrderId: po.id, lines: [{ itemId: iA.id, quantity: 4 }], reason: "Damaged on arrival" })
  const r1 = await purchaseReturnDetail(admin, id1)
  check("number PR-", /^PR-\d{6}$/.test(r1.returnNumber), r1.returnNumber)
  check("goods 40.00", eq(r1.goodsAmount, 40), r1.goodsAmount)
  check("discount share 4.00", eq(r1.discount, "4"), r1.discount)
  check("tax share 2.00", eq(r1.tax, "2"), r1.tax)
  check("credit 38.00", eq(r1.creditTotal, "38"), r1.creditTotal)
  check("cost value 4 x avg 10 = 40", eq(r1.costValue!, 40), r1.costValue)
  let s = await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId: pA.id, warehouseId: f.wh.id } } })
  check("stock A 10 -> 6", s.quantity === 6, s.quantity)
  check("avg cost unchanged 10", eq(s.avgCost, 10), s.avgCost)
  bal = (await getSupplierBalances([f.supplier.id])).get(f.supplier.id)!
  check("supplier balance 114 - 38 = 76", eq(bal, "76"), bal)
  const mv = await prisma.stockMovement.findMany({ where: { referenceId: id1 } })
  check("one OUT movement of 4", mv.length === 1 && mv[0].type === "OUT" && mv[0].quantity === 4, mv)
  const ve = await prisma.inventoryValuationEntry.findMany({ where: { type: "PURCHASE_RETURN", purchaseOrderItemId: iA.id } })
  check("valuation entry PURCHASE_RETURN 40", ve.length === 1 && eq(ve[0].amount, 40), ve)

  // Returnable now 6; reserved units cannot be returned.
  await createSalesOrder(admin, { customerId: f.customer.id, warehouseId: f.wh.id, mode: "confirm", items: [{ productId: pA.id, quantity: 3, unitPrice: 20 }] })
  await expectError("reserved units cannot be returned (6 on hand, 3 reserved, ask 4)", () => createPurchaseReturn(admin, { purchaseOrderId: po.id, lines: [{ itemId: iA.id, quantity: 4 }], reason: "x" }), 400)

  // Refund in EVC Plus: B 5 x 4 = 20.00, discount 12 x 20/120 = 2.00, tax 6 x 20/120 = 1.00 -> credit 19.00
  const refundBody = (amount: string, extra: object = {}) => ({
    purchaseOrderId: po.id,
    lines: [{ itemId: iB.id, quantity: 5 }],
    reason: "Wrong item",
    refund: { amount, paymentMethod: "EVC_PLUS", payerPhone: "615123456", transactionId: "TX1", ...extra },
  })
  await expectError("refund above credit", () => createPurchaseReturn(admin, refundBody("19.01")), 400)
  await expectError("mobile refund needs a phone", () => createPurchaseReturn(admin, refundBody("19", { payerPhone: "" })), 400)
  const id2 = await createPurchaseReturn(admin, refundBody("19"))
  const r2 = await purchaseReturnDetail(admin, id2)
  check("credit 19.00", eq(r2.creditTotal, "19"), r2.creditTotal)
  check("refund stored with method + phone", eq(r2.refundAmount, "19") && r2.refundMethod === "EVC_PLUS" && r2.payerPhone === "+252615123456", r2)
  bal = (await getSupplierBalances([f.supplier.id])).get(f.supplier.id)!
  check("a full refund leaves the balance at 76", eq(bal, "76"), bal)
  await expectError("B fully returned: nothing left", () => createPurchaseReturn(admin, { purchaseOrderId: po.id, lines: [{ itemId: iB.id, quantity: 1 }], reason: "x" }), 400)

  // Concurrent returns cannot exceed what is available (3 free units of A).
  const race = await Promise.allSettled([
    createPurchaseReturn(admin, { purchaseOrderId: po.id, lines: [{ itemId: iA.id, quantity: 3 }], reason: "race 1" }),
    createPurchaseReturn(admin, { purchaseOrderId: po.id, lines: [{ itemId: iA.id, quantity: 3 }], reason: "race 2" }),
  ])
  check("race: exactly one return succeeds", race.filter((x) => x.status === "fulfilled").length === 1, race.map((x) => x.status))
  s = await prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId: pA.id, warehouseId: f.wh.id } } })
  check("stock A 3 left, all reserved", s.quantity === 3 && s.reservedQuantity === 3, s)

  finish()
}

main().finally(() => prisma.$disconnect())

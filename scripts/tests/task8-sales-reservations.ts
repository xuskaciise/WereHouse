// Task 8 integration test on the DEV database (never staging/production).
import { prisma } from "@/lib/prisma"
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS } from "@/lib/permission-rules"
import type { SessionUser } from "@/lib/auth-guard"
import { incrementStock } from "@/lib/stock"
import {
  cancelSalesOrder, confirmSalesOrder, createSalesOrder, deliverSalesOrder, editSalesOrder,
  extendReservation, listReservations, releaseReservation, salesOrderDetail, deleteDraftSalesOrder,
} from "@/lib/sales-orders"
import { getCustomerBalances } from "@/lib/balances"
import { salesProfit } from "@/lib/profit"

const host = new URL(process.env.DATABASE_URL!).hostname
if (!host.startsWith("ep-icy-glade")) throw new Error("not the dev database: " + host)
console.log("dev host:", host)

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail)}`)
  if (!ok) failures++
}
async function expectError(name: string, fn: () => Promise<unknown>, status: number) {
  try { await fn(); check(name, false, "no error") } catch (e: any) { check(name, e?.status === status, `${e?.status} ${e?.message}`) }
}

const tag = "t8" + Date.now().toString(36)
async function stockOf(productId: string, warehouseId: string) {
  return prisma.stock.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } })
}

async function main() {
  const adminRow = await prisma.user.upsert({
    where: { username: "t8_admin" }, update: {}, create: { username: "t8_admin", name: "T8 Admin", role: "ADMIN", status: "APPROVED" },
  })
  const officerRow = await prisma.user.upsert({
    where: { username: "t8_officer" }, update: {}, create: { username: "t8_officer", name: "T8 Officer", role: "SALES_OFFICER", status: "APPROVED" },
  })
  const admin: SessionUser = { id: adminRow.id, name: "a", username: adminRow.username, role: "ADMIN", permissions: ADMIN_PERMISSIONS }
  const officer: SessionUser = { id: officerRow.id, name: "o", username: officerRow.username, role: "SALES_OFFICER", permissions: DEFAULT_PERMISSIONS.SALES_OFFICER }
  const wm: SessionUser = { id: adminRow.id, name: "w", username: "wm", role: "WAREHOUSE_MANAGER", permissions: DEFAULT_PERMISSIONS.WAREHOUSE_MANAGER }

  // 5% sales tax for this run (restored at the end).
  const taxBefore = await prisma.setting.findUnique({ where: { key: "salesTaxRate" } })
  await prisma.setting.upsert({ where: { key: "salesTaxRate" }, update: { value: "5" }, create: { key: "salesTaxRate", value: "5" } })

  const wh = await prisma.warehouse.create({ data: { name: `WH ${tag}`, code: tag, userId: admin.id } })
  const cat = await prisma.category.create({ data: { name: `Cat ${tag}`, userId: admin.id } })
  const mk = (n: string, price: number, cost: number) => prisma.product.create({ data: { name: `${n} ${tag}`, sku: `${n}-${tag}`, categoryId: cat.id, sellingPrice: price, costPrice: cost, reorderLevel: 5, userId: admin.id } })
  const [pA, pB, pC] = await Promise.all([mk("A", 3.33, 2), mk("B", 7.77, 5), mk("C", 1.1, 0.5)])
  const cust = await prisma.customer.create({ data: { name: `Cust ${tag}`, email: "c@x.so", userId: admin.id } })
  const custO = await prisma.customer.create({ data: { name: `CustO ${tag}`, email: "o@x.so", userId: officer.id } })
  await prisma.$transaction(async (tx) => {
    for (const p of [pA, pB, pC]) await incrementStock(tx, { productId: p.id, warehouseId: wh.id, quantity: 50, userId: admin.id })
  })

  const body = (extra: any = {}) => ({
    customerId: cust.id, warehouseId: wh.id,
    items: [
      { productId: pA.id, quantity: 7, unitPrice: 3.33, discount: { type: "PERCENT", value: 3 } },
      { productId: pB.id, quantity: 3, unitPrice: 7.77 },
      { productId: pC.id, quantity: 11, unitPrice: 1.1 },
    ],
    discount: { type: "AMOUNT", value: "1.37" },
    ...extra,
  })

  // 1. Draft: no stock touched.
  const d1 = await createSalesOrder(admin, body())
  let s = await stockOf(pA.id, wh.id)
  check("draft: quantity and reserved unchanged", s.quantity === 50 && s.reservedQuantity === 0, s)
  const o1 = await salesOrderDetail(admin, d1)
  check("draft status DRAFT", o1.status === "DRAFT", o1.status)
  await expectError("draft cannot be delivered", () => deliverSalesOrder(admin, d1, {}), 400)

  // 2. Confirm reserves.
  await confirmSalesOrder(admin, d1)
  s = await stockOf(pA.id, wh.id)
  check("confirm: reserved 7, quantity 50", s.quantity === 50 && s.reservedQuantity === 7, s)
  const c1 = await salesOrderDetail(admin, d1)
  check("confirm: reservedUntil ~7 days", !!c1.reservedUntil && Math.abs(c1.reservedUntil.getTime() - Date.now() - 7 * 864e5) < 60_000)
  check("customer debt 0 before delivery", (await getCustomerBalances([cust.id])).get(cust.id)!.isZero())

  // 3. Confirm fails when not enough available (50 - 7 = 43 < 44).
  const big = await createSalesOrder(admin, body({ items: [{ productId: pA.id, quantity: 44, unitPrice: 3.33 }], discount: null }))
  await expectError("confirm over available -> 400", () => confirmSalesOrder(admin, big), 400)
  check("failed confirm changed nothing", (await stockOf(pA.id, wh.id)).reservedQuantity === 7)

  // 4. Partial deliveries, then the rest: deliveries add up exactly to the order.
  const [iA, iB, iC] = c1.items
  await deliverSalesOrder(wm, d1, { lines: [{ itemId: iA.id, quantity: 3 }, { itemId: iC.id, quantity: 5 }] })
  s = await stockOf(pA.id, wh.id)
  check("partial: A quantity 47, reserved 4", s.quantity === 47 && s.reservedQuantity === 4, s)
  let p1 = await salesOrderDetail(admin, d1)
  check("status PARTIALLY_DELIVERED", p1.status === "PARTIALLY_DELIVERED", p1.status)
  await expectError("cannot deliver more than remaining", () => deliverSalesOrder(admin, d1, { lines: [{ itemId: iA.id, quantity: 5 }] }), 400)
  await deliverSalesOrder(admin, d1, { lines: [{ itemId: iB.id, quantity: 1 }] })
  await deliverSalesOrder(admin, d1, { lines: "all" })
  p1 = await salesOrderDetail(admin, d1)
  const sum = (k: "subtotal" | "discount" | "tax" | "total") => p1.deliveries.reduce((a, d) => a.plus(d[k]), new (p1.total.constructor as any)(0))
  check("DELIVERED after the rest", p1.status === "DELIVERED", p1.status)
  check("3 deliveries", p1.deliveries.length === 3, p1.deliveries.length)
  check("deliveries subtotal = order subtotal", sum("subtotal").equals(p1.subtotal), [sum("subtotal"), p1.subtotal])
  check("deliveries discount = order discount", sum("discount").equals(p1.discount), [sum("discount"), p1.discount])
  check("deliveries tax = order tax", sum("tax").equals(p1.tax), [sum("tax"), p1.tax])
  check("deliveries total = order total", sum("total").equals(p1.total), [sum("total"), p1.total])
  for (const d of p1.deliveries) {
    const items = d.items.reduce((a, i) => a.plus(i.amount), new (p1.total.constructor as any)(0))
    const disc = d.items.reduce((a, i) => a.plus(i.discount), new (p1.total.constructor as any)(0))
    check(`${d.deliveryNumber}: item amounts/discounts add up`, items.equals(d.subtotal) && disc.equals(d.discount))
  }
  s = await stockOf(pA.id, wh.id)
  check("fully delivered: A quantity 43, reserved 0", s.quantity === 43 && s.reservedQuantity === 0, s)
  const bal = (await getCustomerBalances([cust.id])).get(cust.id)!
  check("customer debt = delivered total", bal.equals(p1.total), [bal, p1.total])
  const moves = await prisma.stockMovement.count({ where: { referenceId: d1, type: "OUT" } })
  check("OUT movements: 3 lines x 2 partial deliveries = 6", moves === 6, moves)
  const profit = await salesProfit({ where: { customerId: cust.id } })
  check("profit revenue = subtotal - discount", profit.totals.revenue.equals(p1.subtotal.minus(p1.discount)), profit.totals)
  check("COGS = 7x2 + 3x5 + 11x0.5 = 34.5", profit.totals.cogs.equals(34.5), profit.totals.cogs)

  // 5. Cancel a confirmed order releases everything.
  const d2 = await createSalesOrder(admin, body({ mode: "confirm" }))
  check("mode confirm reserves", (await stockOf(pB.id, wh.id)).reservedQuantity === 3)
  await expectError("cancel needs a reason", () => cancelSalesOrder(admin, d2, {}), 400)
  await cancelSalesOrder(admin, d2, { reason: "customer changed mind" })
  check("cancel releases", (await stockOf(pB.id, wh.id)).reservedQuantity === 0)
  check("cancelled status", (await salesOrderDetail(admin, d2)).status === "CANCELLED")
  await expectError("cancelled cannot be confirmed", () => confirmSalesOrder(admin, d2), 400)

  // 6. Partial then cancel -> closed as DELIVERED; rest released.
  const d3 = await createSalesOrder(admin, body({ mode: "confirm" }))
  const i3 = (await salesOrderDetail(admin, d3)).items
  await deliverSalesOrder(admin, d3, { lines: [{ itemId: i3[1].id, quantity: 2 }] })
  await cancelSalesOrder(admin, d3, { reason: "rest not needed" })
  const o3 = await salesOrderDetail(admin, d3)
  check("partial + cancel -> DELIVERED (closed short)", o3.status === "DELIVERED" && o3.items[1].releasedQuantity === 1, o3.items.map((i) => [i.deliveredQuantity, i.releasedQuantity]))
  check("nothing left reserved", (await prisma.stock.aggregate({ where: { warehouseId: wh.id }, _sum: { reservedQuantity: true } }))._sum.reservedQuantity === 0)

  // 7. Sell & deliver now.
  const before = (await stockOf(pC.id, wh.id)).quantity
  const d4 = await createSalesOrder(admin, body({ mode: "sell_now", items: [{ productId: pC.id, quantity: 2, unitPrice: 1.1 }], discount: null }))
  const o4 = await salesOrderDetail(admin, d4)
  check("sell now: DELIVERED with one delivery", o4.status === "DELIVERED" && o4.deliveries.length === 1 && o4.deliveries[0].total.equals(o4.total))
  s = await stockOf(pC.id, wh.id)
  check("sell now: quantity -2, reserved 0", s.quantity === before - 2 && s.reservedQuantity === 0, s)

  // 8. Edit a confirmed order adjusts the reservation; delivered orders cannot be edited.
  const d5 = await createSalesOrder(admin, body({ mode: "confirm", items: [{ productId: pA.id, quantity: 2, unitPrice: 3.33 }], discount: null }))
  await editSalesOrder(admin, d5, body({ items: [{ productId: pA.id, quantity: 5, unitPrice: 3.33 }, { productId: pB.id, quantity: 1, unitPrice: 7.77 }], discount: null }))
  check("edit: A reserved 5, B reserved 1", (await stockOf(pA.id, wh.id)).reservedQuantity === 5 && (await stockOf(pB.id, wh.id)).reservedQuantity === 1)
  await expectError("delivered order cannot be edited", () => editSalesOrder(admin, d4, body()), 400)

  // 9. Reservations: extend / release, expired list.
  await prisma.salesOrder.update({ where: { id: d5 }, data: { reservedUntil: new Date(Date.now() - 3600_000) } })
  const expired = await listReservations(admin, { expiredOnly: true })
  check("expired list contains the order", expired.some((o) => o.id === d5))
  await expectError("extend needs a future date", () => extendReservation(admin, d5, { until: "2020-01-01", reason: "x" }), 400)
  await extendReservation(admin, d5, { until: new Date(Date.now() + 3 * 864e5).toISOString(), reason: "customer pays Friday" })
  check("extended: no longer expired", !(await listReservations(admin, { expiredOnly: true })).some((o) => o.id === d5))
  await expectError("officer cannot see / release another user's order (OWN scope)", () => releaseReservation(officer, d5, { reason: "x" }), 404)
  await expectError("warehouse manager cannot confirm (no sales_confirm)", () => confirmSalesOrder(wm, d1), 403)
  await releaseReservation(admin, d5, { reason: "no payment" })
  check("released: CANCELLED, reserved 0", (await salesOrderDetail(admin, d5)).status === "CANCELLED" && (await stockOf(pA.id, wh.id)).reservedQuantity === 0)

  // 10. Scope: an officer only sees / acts on own orders.
  await expectError("officer cannot confirm others' draft", () => confirmSalesOrder(officer, big), 404)
  const own = await createSalesOrder(officer, { customerId: custO.id, warehouseId: wh.id, items: [{ productId: pC.id, quantity: 1, unitPrice: 1.1 }], mode: "sell_now" })
  check("officer sell now on own order", (await salesOrderDetail(officer, own)).status === "DELIVERED")

  // 11. Race: two confirms for the last units - exactly one wins.
  const avail = (await stockOf(pB.id, wh.id)).quantity - (await stockOf(pB.id, wh.id)).reservedQuantity
  const r1 = await createSalesOrder(admin, body({ items: [{ productId: pB.id, quantity: avail, unitPrice: 7.77 }], discount: null }))
  const r2 = await createSalesOrder(admin, body({ items: [{ productId: pB.id, quantity: avail, unitPrice: 7.77 }], discount: null }))
  const results = await Promise.allSettled([confirmSalesOrder(admin, r1), confirmSalesOrder(admin, r2)])
  check("race: exactly one confirm succeeds", results.filter((r) => r.status === "fulfilled").length === 1, results.map((r) => r.status))
  s = await stockOf(pB.id, wh.id)
  check("race: reserved never above quantity", s.reservedQuantity <= s.quantity && s.reservedQuantity === avail, s)

  // 12. Drafts can be deleted, others not.
  await deleteDraftSalesOrder(admin, big)
  const confirmedRace = results[0].status === "fulfilled" ? r1 : r2
  await expectError("confirmed cannot be deleted", () => deleteDraftSalesOrder(admin, confirmedRace), 400)

  // 13. Reconciliation invariant over the whole database.
  const mismatches = await prisma.$queryRaw<any[]>`
    WITH open_lines AS (
      SELECT so."warehouseId", i."productId", SUM(i."quantity" - i."deliveredQuantity" - i."releasedQuantity")::int AS units
      FROM "sales_order_items" i JOIN "sales_orders" so ON so."id" = i."salesOrderId"
      WHERE so."status" IN ('CONFIRMED', 'PARTIALLY_DELIVERED') GROUP BY 1, 2)
    SELECT s."productId", s."warehouseId", s."reservedQuantity", COALESCE(o.units, 0) AS expected
    FROM "stock" s LEFT JOIN open_lines o ON o."productId" = s."productId" AND o."warehouseId" = s."warehouseId"
    WHERE s."reservedQuantity" <> COALESCE(o.units, 0)`
  check("reconciliation: reserved = open undelivered quantities", mismatches.length === 0, mismatches)

  // Clean up the reservation left by the race so dev data stays consistent.
  await cancelSalesOrder(admin, r1, { reason: "test cleanup" }).catch(() => {})
  await cancelSalesOrder(admin, r2, { reason: "test cleanup" }).catch(() => {})
  if (taxBefore) await prisma.setting.update({ where: { key: "salesTaxRate" }, data: { value: taxBefore.value } })
  else await prisma.setting.delete({ where: { key: "salesTaxRate" } })

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`)
  process.exitCode = failures ? 1 : 0
}

main().finally(() => prisma.$disconnect())

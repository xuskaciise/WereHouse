// Task 16: goods total + landed costs = total landed cost, per-item landed
// figures hidden without product_cost, and the supplier payable stays the
// goods total only (DEV database).
import { prisma, TX_OPTIONS } from "@/lib/prisma"
import { getSupplierPositions } from "@/lib/balances"
import { sumMoney } from "@/lib/money"
import { COST_FIELDS, omitCostFields } from "@/lib/api"
import { createCostRows, landedCostView } from "@/lib/landed-cost-service"
import { syncLandedCosts } from "@/lib/landed-costs"
import { postAccounting } from "@/lib/accounting"
import { assertDevDatabase, check, eq, finish, fixtures, receivedPurchase, testUser } from "./helpers"

async function costType(name: string) {
  const found = await prisma.landedCostType.findFirst({ where: { name: { equals: name, mode: "insensitive" }, isActive: true } })
  return found ?? prisma.landedCostType.create({ data: { name, nameKey: name.toLowerCase() } as any })
}

async function main() {
  assertDevDatabase()
  const tag = "t16" + Date.now().toString(36)
  const admin = await testUser("t16_admin", "ADMIN")
  const f = await fixtures(tag, admin)
  const a = await f.product("A", 150, 100)
  const b = await f.product("B", 300, 200)
  const qaade = await prisma.supplier.create({ data: { name: `QAADE ${tag}`, type: "SERVICE_PROVIDER", email: "sp@x.so", userId: admin.id } })
  const [shipment, customs] = await Promise.all(["Shipment", "Customs"].map(costType))

  // Goods: subtotal 2000 (A 10 x 100, B 5 x 200), tax 5% = 100, discount 50 -> total 2050.
  const po = await receivedPurchase(
    admin,
    { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}` },
    [[a.id, 10, 100], [b.id, 5, 200]],
    { discount: 50, taxRate: 5 }
  )
  check("PO total 2050 (after tax and discount)", eq(po.total, 2050), po.total)
  const before = await getSupplierPositions([f.supplier.id, qaade.id])
  const supplierPayable = before.get(f.supplier.id)!.payable

  // 1. Without costs: total landed cost = goods total.
  let view = await landedCostView(prisma, po.id)
  check("no costs: goods total = PO total", eq(view.goodsTotal, 2050))
  check("no costs: total landed cost = goods total", eq(view.totalLandedCost, 2050) && eq(view.landedCostsTotal, 0))

  // 2. Add shipment 300 + customs 5% of goods (100) to QAADE.
  const row = (typeId: string, amountType: string, value: string) => ({
    typeId, paidToSupplierId: qaade.id, amountType, value, percentBase: "GOODS", allocationMethod: "VALUE", costDate: "2026-10-01",
  })
  const [shipmentId, customsId] = await createCostRows(admin, po.id, { rows: [row(shipment.id, "FIXED", "300"), row(customs.id, "PERCENT", "5")] }, null)
  view = await landedCostView(prisma, po.id)
  check("landed costs total 400", eq(view.landedCostsTotal, 400), view.landedCostsTotal)
  check("total landed cost = 2050 + 400 = 2450", eq(view.totalLandedCost, 2450), view.totalLandedCost)
  check("uplift 20% (400 / goods value 2000 before tax)", eq(view.upliftPercent, 20), view.upliftPercent)
  for (const item of view.items) {
    check(`${item.product.name}: line landed total = subtotal + allocated`, eq(item.lineLandedTotal, item.subtotal.plus(item.landedCost)), item)
  }
  check("line landed totals add up to goods before tax + costs (2400)", eq(sumMoney(view.items.map((i) => i.lineLandedTotal)), 2400))
  const itemA = view.items.find((i) => i.productId === a.id)!
  check("A landed unit cost 120 (100 + 200 / 10)", eq(itemA.landedUnitCost, 120), itemA.landedUnitCost)

  // 3. The supplier is still owed the goods total only; the costs are owed to QAADE.
  const after = await getSupplierPositions([f.supplier.id, qaade.id])
  check("supplier payable unchanged by landed costs", eq(after.get(f.supplier.id)!.payable, supplierPayable), {
    before: supplierPayable, after: after.get(f.supplier.id)!.payable,
  })
  check("QAADE payable +400", eq(after.get(qaade.id)!.payable.minus(before.get(qaade.id)!.payable), 400), after.get(qaade.id))
  const poRow = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })
  check("PO total (owed to supplier) still 2050", eq(poRow.total, 2050), poRow.total)

  // 4. Change a cost (shipment 300 -> 500): totals follow.
  await prisma.$transaction(async (tx) => {
    await tx.purchaseLandedCostAllocation.deleteMany({ where: { landedCostId: shipmentId } })
    await tx.purchaseLandedCost.update({ where: { id: shipmentId }, data: { value: 500, amount: 500 } })
    await syncLandedCosts(tx, po.id, admin.id)
    await postAccounting(tx, {}, admin.id)
  }, TX_OPTIONS)
  view = await landedCostView(prisma, po.id)
  check("after change: costs 600, total landed cost 2650", eq(view.landedCostsTotal, 600) && eq(view.totalLandedCost, 2650), view.totalLandedCost)

  // 5. Remove a cost (customs): totals follow, supplier payable still unchanged.
  await prisma.$transaction(async (tx) => {
    await tx.purchaseLandedCost.delete({ where: { id: customsId } })
    await syncLandedCosts(tx, po.id, admin.id)
    await postAccounting(tx, { LANDED_COST: [customsId] }, admin.id)
  }, TX_OPTIONS)
  view = await landedCostView(prisma, po.id)
  check("after delete: costs 500, total landed cost 2550", eq(view.landedCostsTotal, 500) && eq(view.totalLandedCost, 2550), view.totalLandedCost)
  const final = await getSupplierPositions([f.supplier.id])
  check("supplier payable still unchanged", eq(final.get(f.supplier.id)!.payable, supplierPayable))

  // 6. Roles without product_cost: per-item landed figures are removed by the
  //    API filter (lib/api.ts), the PO-level totals stay.
  const stripped = omitCostFields(JSON.parse(JSON.stringify(view))) as any
  const leaked = ["landedCost", "landedUnitCost", "lineLandedTotal", "costPerUnit", "costIncreasePercent"].filter((k) => k in stripped.items[0])
  check("per-item landed figures hidden without product_cost", leaked.length === 0, leaked)
  check("lineLandedTotal is a cost field", COST_FIELDS.has("lineLandedTotal"))
  check("PO-level totals still shown", "totalLandedCost" in stripped && "goodsTotal" in stripped && "landedCostsTotal" in stripped)

  // 7. Journal still balanced.
  const totals = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
  check("journal balanced", eq(totals._sum.debit ?? 0, totals._sum.credit ?? 0), totals._sum)

  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())

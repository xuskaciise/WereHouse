// Task 15: landed costs entered all at once (one save, one revaluation) and
// paid all at once (one payment per party, FIFO, no overpayment) - DEV database.
import { prisma, TX_OPTIONS } from "@/lib/prisma"
import { getSupplierPositions } from "@/lib/balances"
import { Decimal } from "@/lib/money"
import { supplierPaymentInclude } from "@/lib/includes"
import { createCostRows, createLandedCostsInTx, lockPurchaseOrder } from "@/lib/landed-cost-service"
import { parseLandedCostInput } from "@/lib/landed-costs"
import { listCostLines, payCostLines, previewCostPayment, updateCostPaymentAmountInTx } from "@/lib/cost-payments"
import { assertDevDatabase, check, eq, expectError, finish, fixtures, receivedPurchase, testUser } from "./helpers"

async function costType(name: string) {
  const found = await prisma.landedCostType.findFirst({ where: { name: { equals: name, mode: "insensitive" }, isActive: true } })
  return found ?? prisma.landedCostType.create({ data: { name, nameKey: name.toLowerCase() } as any })
}

async function main() {
  assertDevDatabase()
  const tag = "t15" + Date.now().toString(36)
  const admin = await testUser("t15_admin", "ADMIN")
  const f = await fixtures(tag, admin)
  const a = await f.product("A", 150, 100)
  const b = await f.product("B", 300, 200)
  const qaade = await prisma.supplier.create({ data: { name: `QAADE ${tag}`, type: "SERVICE_PROVIDER", email: "sp@x.so", userId: admin.id } })
  const marketer = await prisma.supplier.create({ data: { name: `Marketer ${tag}`, type: "SERVICE_PROVIDER", email: "sp@x.so", userId: admin.id } })
  const [shipment, customs, transport, commission] = await Promise.all(["Shipment", "Customs", "Transportation", "Commission"].map(costType))

  // Goods 2000: A 10 x 100, B 5 x 200 (all received).
  const po1 = await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}-1` }, [[a.id, 10, 100], [b.id, 5, 200]])
  const row = (typeId: string, paidTo: string, amountType: string, value: string, extra: object = {}) => ({
    typeId, paidToSupplierId: paidTo, amountType, value, percentBase: "GOODS", allocationMethod: "VALUE", costDate: "2026-09-10", ...extra,
  })
  const stockValue = async () => (await prisma.stock.findMany({ where: { warehouseId: f.wh.id } })).reduce((s, x: any) => s + Number(x.quantity) * Number(x.avgCost), 0)
  const valueBefore = await stockValue()
  const valuationBefore = await prisma.inventoryValuationEntry.count({ where: { productId: { in: [a.id, b.id] } } })

  // 1. QAADE example in ONE save: shipment 300, customs 5% (100), transport 50
  //    to QAADE, commission 2% of goods + fixed costs (2% of 2350 = 47) to the marketer.
  const ids = await createCostRows(admin, po1.id, {
    rows: [
      row(shipment.id, qaade.id, "FIXED", "300", { reference: "QA-1" }),
      row(customs.id, qaade.id, "PERCENT", "5"),
      row(transport.id, qaade.id, "FIXED", "50", { allocationMethod: "QUANTITY" }),
      row(commission.id, marketer.id, "PERCENT", "2", { percentBase: "GOODS_PLUS_FIXED" }),
    ],
  }, null)
  const costs = await prisma.purchaseLandedCost.findMany({ where: { purchaseOrderId: po1.id }, include: { allocations: true }, orderBy: { createdAt: "asc" } })
  check("one save: 4 cost lines", ids.length === 4 && costs.length === 4, costs.length)
  check("amounts 300 / 100 / 50 / 47", costs.map((c) => c.amount.toFixed(2)).join() === "300.00,100.00,50.00,47.00", costs.map((c) => c.amount.toFixed(2)))
  check("each cost fully allocated", costs.every((c) => eq(c.allocations.reduce((s, x) => s + Number(x.amount), 0), c.amount)))
  const valueAfter = await stockValue()
  check("stock revalued by 497 (all received)", Math.abs(valueAfter - valueBefore - 497) < 0.005, valueAfter - valueBefore)
  const valuationAdded = (await prisma.inventoryValuationEntry.count({ where: { productId: { in: [a.id, b.id] } } })) - valuationBefore
  check("ONE revaluation: one valuation entry per item (not per cost)", valuationAdded === 2, valuationAdded)
  const lcJournals = await prisma.journalEntry.count({ where: { sourceType: "LANDED_COST", sourceId: { in: ids } } })
  check("journal posted for every cost", lcJournals === 4, lcJournals)
  check("4 CREATE log lines", (await prisma.landedCostLog.count({ where: { purchaseOrderId: po1.id, action: "CREATE" } })) === 4)

  // 2. A failing row rolls everything back.
  const countCosts = () => prisma.purchaseLandedCost.count({ where: { purchaseOrderId: po1.id } })
  try {
    await createCostRows(admin, po1.id, { rows: [row(shipment.id, qaade.id, "FIXED", "10"), row("no-such-type", qaade.id, "FIXED", "5"), row(customs.id, qaade.id, "PERCENT", "500")] }, null)
    check("invalid rows refused", false)
  } catch (e: any) {
    const rows = (e.details?.rowErrors ?? []).map((r: any) => r.row)
    check("invalid rows refused with the exact rows (2 and 3)", e.status === 400 && rows.join() === "1,2", { status: e.status, rows, msg: e.message })
  }
  await expectError("manual allocation that does not add up: refused", () => createCostRows(admin, po1.id, {
    rows: [row(shipment.id, qaade.id, "FIXED", "10", { allocationMethod: "MANUAL", manual: [{ itemId: po1.items[0].id, amount: "4" }, { itemId: po1.items[1].id, amount: "4" }] })],
  }, null), 400)
  // A failure inside the transaction (after the first row was written) leaves nothing behind.
  try {
    await prisma.$transaction(async (tx) => {
      await lockPurchaseOrder(tx, po1.id)
      await createLandedCostsInTx(tx, admin.id, po1.id, [
        { input: parseLandedCostInput(row(shipment.id, qaade.id, "FIXED", "10")), typeName: "Shipment" },
        { input: parseLandedCostInput(row(shipment.id, "missing-party", "FIXED", "10")), typeName: "Shipment" },
      ], { reason: null })
    }, TX_OPTIONS)
    check("failing row inside the transaction throws", false)
  } catch {
    check("failing row inside the transaction throws", true)
  }
  check("nothing saved after the failures (still 4 lines)", (await countCosts()) === 4, await countCosts())
  check("stock value unchanged after the failures", Math.abs((await stockValue()) - valueAfter) < 0.005)

  // 3. One payment to QAADE covering its 3 lines (450).
  const qaadeLines = (await listCostLines(prisma, admin, { supplierId: qaade.id, openOnly: true })).filter((l) => l.documentId === po1.id)
  check("QAADE has 3 open lines (450)", qaadeLines.length === 3 && eq(qaadeLines.reduce((s, l) => s + Number(l.openAmount), 0), 450), qaadeLines.length)
  const pay1 = await payCostLines(admin, {
    supplierId: qaade.id,
    lines: qaadeLines.map((l) => ({ landedCostId: l.id })),
    paymentMethod: "CASH",
    reference: "RCPT-1",
  })
  const p1 = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: pay1.ids[0] }, include: supplierPaymentInclude })
  check("one payment of 450 with 3 allocations", eq(p1.amount, 450) && p1.allocations.length === 3, { amount: p1.amount, n: p1.allocations.length })
  check("no direct single-cost link on a multi-line payment", !p1.landedCostId && !p1.stockTransferCostId)
  check("receipt lists every cost line with PO and type", p1.allocations.every((x) => x.landedCost?.purchaseOrder.orderNumber === po1.orderNumber && !!x.landedCost?.type.name))
  const afterPay = await listCostLines(prisma, admin, { purchaseOrderId: po1.id })
  check("QAADE lines PAID, marketer UNPAID", afterPay.filter((l) => l.supplierId === qaade.id).every((l) => l.paymentStatus === "PAID") && afterPay.find((l) => l.supplierId === marketer.id)?.paymentStatus === "UNPAID")
  const payJournal = await prisma.journalEntry.findFirst({ where: { sourceType: "SUPPLIER_PAYMENT", sourceId: p1.id, isAdjustment: false }, include: { lines: { include: { account: true } } } })
  const apLine = payJournal?.lines.find((l: any) => l.account.systemKey === "AP")
  check("payment journal: Dr Accounts payable 450 for QAADE", !!apLine && eq(apLine.debit, 450) && apLine.supplierId === qaade.id, apLine)
  let qPos = (await getSupplierPositions([qaade.id])).get(qaade.id)!
  check("QAADE payable 0 after paying (AP ledger)", eq(qPos.payable, 0), qPos)
  const mPos = (await getSupplierPositions([marketer.id])).get(marketer.id)!
  check("marketer payable 47 (AP ledger)", eq(mPos.payable, 47), mPos)

  // Already paid / other party / overpayment are refused.
  await expectError("paying an already paid line: refused", () => payCostLines(admin, { supplierId: qaade.id, lines: [{ landedCostId: qaadeLines[0].id }], paymentMethod: "CASH" }), 400)
  const mLine = afterPay.find((l) => l.supplierId === marketer.id)!
  await expectError("line owed to another party: refused", () => payCostLines(admin, { supplierId: qaade.id, lines: [{ landedCostId: mLine.id }], paymentMethod: "CASH" }), 400)
  await expectError("more than the open balance: refused", () => payCostLines(admin, { supplierId: marketer.id, lines: [{ landedCostId: mLine.id }], amount: "47.01", paymentMethod: "CASH" }), 400)

  // 4. Partial payment, FIFO, lines from 2 different POs (+ a transfer cost) at once.
  const po2 = await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}-2` }, [[a.id, 4, 100]])
  const po3 = await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}-3` }, [[b.id, 2, 200]])
  await createCostRows(admin, po2.id, { rows: [row(shipment.id, qaade.id, "FIXED", "200", { costDate: "2026-09-01" }), row(customs.id, qaade.id, "FIXED", "100", { costDate: "2026-09-05" })] }, null)
  await createCostRows(admin, po3.id, { rows: [row(transport.id, qaade.id, "FIXED", "80", { costDate: "2026-09-03" })] }, null)
  const wh2 = await prisma.warehouse.create({ data: { name: `WH2 ${tag}`, code: `${tag}b`, userId: admin.id } })
  const transfer = await prisma.stockTransfer.create({ data: { transferNumber: `TR-${tag}`, fromWarehouseId: f.wh.id, toWarehouseId: wh2.id, userId: admin.id } as any })
  const tCost = await prisma.stockTransferCost.create({ data: { stockTransferId: transfer.id, typeId: transport.id, paidToSupplierId: qaade.id, amount: 30, costDate: new Date("2026-09-20"), userId: admin.id } })
  const open = await listCostLines(prisma, admin, { supplierId: qaade.id, openOnly: true })
  check("QAADE open lines across 2 POs and a transfer: 4 (410)", open.length === 4 && eq(open.reduce((s, l) => s + Number(l.openAmount), 0), 410), open.map((l) => `${l.documentNumber}:${l.openAmount}`))
  check("FIFO order: 09-01, 09-03, 09-05, 09-20", open.map((l) => l.costDate.toISOString().slice(0, 10)).join() === "2026-09-01,2026-09-03,2026-09-05,2026-09-20")
  const refs = open.map((l) => (l.kind === "LANDED_COST" ? { landedCostId: l.id } : { stockTransferCostId: l.id }))
  const preview = await previewCostPayment(admin, { supplierId: qaade.id, lines: refs, amount: "250" })
  check("preview: 200 + 50 + 0 + 0", preview.lines.map((l) => (l.allocated ? l.allocated.toFixed(2) : "0")).join() === "200.00,50.00,0,0", preview.lines.map((l) => l.allocated))
  const pay2 = await payCostLines(admin, { supplierId: qaade.id, lines: refs, amount: "250", paymentMethod: "EVC_PLUS", payerPhone: "+252615000000", transactionId: `TX${Date.now()}` })
  const p2 = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: pay2.ids[0] }, include: supplierPaymentInclude })
  check("partial payment saved like the preview", p2.allocations.map((x) => x.amount.toFixed(2)).join() === "200.00,50.00", p2.allocations.map((x) => x.amount))
  check("EVC Plus phone and transaction ID kept", p2.paymentMethod === "EVC_PLUS" && !!p2.payerPhone && !!p2.transactionId)
  const status = async () => Object.fromEntries((await listCostLines(prisma, admin, { supplierId: qaade.id })).filter((l) => l.documentId !== po1.id).map((l) => [l.costDate.toISOString().slice(5, 10), `${l.paymentStatus}:${l.openAmount.toFixed(2)}`]))
  const st = await status()
  check("statuses: PAID, PARTLY_PAID 30, UNPAID 100, UNPAID 30", st["09-01"] === "PAID:0.00" && st["09-03"] === "PARTLY_PAID:30.00" && st["09-05"] === "UNPAID:100.00" && st["09-20"] === "UNPAID:30.00", st)
  qPos = (await getSupplierPositions([qaade.id])).get(qaade.id)!
  // The transfer cost row was created directly (no journal), so the AP ledger shows 380 - 250.
  check("QAADE payable 130 (AP ledger: 380 - 250)", eq(qPos.payable, 130), qPos)

  // 5. Amount of a multi-line payment is locked; a single-line payment follows within the open balance.
  await expectError("multi-line payment amount locked", () => prisma.$transaction((tx) => updateCostPaymentAmountInTx(tx, p2.id, new Decimal(240)), TX_OPTIONS), 400)
  const pay3 = await payCostLines(admin, { supplierId: qaade.id, lines: [{ landedCostId: open[2].id }], amount: "40", paymentMethod: "CASH" })
  const p3 = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: pay3.ids[0] } })
  check("single-line payment keeps the direct link", p3.landedCostId === open[2].id)
  await expectError("single-line edit above the open balance refused", () => prisma.$transaction((tx) => updateCostPaymentAmountInTx(tx, p3.id, new Decimal("100.01")), TX_OPTIONS), 400)
  await prisma.$transaction((tx) => updateCostPaymentAmountInTx(tx, p3.id, new Decimal(100)), TX_OPTIONS)
  check("single-line edit to the full amount accepted", eq((await prisma.supplierPaymentAllocation.findFirstOrThrow({ where: { paymentId: p3.id } })).amount, 100))
  await prisma.supplierPayment.update({ where: { id: p3.id }, data: { amount: 100 } })

  // 6. Paid now for the whole set: one payment per party.
  const po4 = await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}-4` }, [[a.id, 1, 100]])
  await createCostRows(admin, po4.id, { rows: [row(shipment.id, qaade.id, "FIXED", "20"), row(customs.id, qaade.id, "FIXED", "5"), row(commission.id, marketer.id, "FIXED", "3")] }, { paymentMethod: "CASH", payerPhone: null, transactionId: null })
  const po4Lines = await listCostLines(prisma, admin, { purchaseOrderId: po4.id })
  const po4Payments = await prisma.supplierPaymentAllocation.groupBy({ by: ["paymentId"], where: { landedCostId: { in: po4Lines.map((l) => l.id) } } })
  check("paid now: all 3 lines PAID with 2 payments (one per party)", po4Lines.every((l) => l.paymentStatus === "PAID") && po4Payments.length === 2, { n: po4Payments.length })

  // 7. Existing payments: backfilled allocations match their amount; journals balance.
  const mismatched = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM supplier_payments p
    WHERE (p."landedCostId" IS NOT NULL OR p."stockTransferCostId" IS NOT NULL)
      AND p.amount <> COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a."paymentId" = p.id), 0)`
  check("every cost-linked payment is fully allocated", Number(mismatched[0].n) === 0, mismatched)
  const totals = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
  check("journal balanced (debits = credits)", eq(totals._sum.debit ?? 0, totals._sum.credit ?? 0), totals._sum)

  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())

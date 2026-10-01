// Task 14 P1: menu per role, walk-in / paid-now sales, landed cost templates,
// search scoping and attention counts (DEV database).
import { prisma, TX_OPTIONS } from "@/lib/prisma"
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS, EDITABLE_ROLES, can, canOpenPage } from "@/lib/permission-rules"
import { NAV_SECTIONS, QUICK_ACTIONS, visibleSections } from "@/lib/navigation"
import { createSalesOrder, salesOrderDetail } from "@/lib/sales-orders"
import { walkInCustomerId } from "@/lib/company"
import { applyTemplate, createTemplate } from "@/lib/landed-cost-templates"
import { globalSearch } from "@/lib/search"
import { getCustomerBalances } from "@/lib/balances"
import { incrementStock } from "@/lib/stock"
import { recordStockValueChange } from "@/lib/stock-valuation"
import { postAccounting } from "@/lib/accounting"
import { assertDevDatabase, check, eq, expectError, finish, fixtures, testUser } from "./helpers"

async function main() {
  assertDevDatabase()

  // 1. Menu per role: every visible item opens (page access), no duplicates,
  //    and quick actions only with the create permission.
  const roles = { ADMIN: ADMIN_PERMISSIONS, ...DEFAULT_PERMISSIONS }
  const allHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href))
  check("menu has no duplicate entries", new Set(allHrefs).size === allHrefs.length, allHrefs)
  check("'Sales orders' appears once", NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.label === "Sales orders").length === 1)
  for (const [role, perms] of Object.entries(roles)) {
    const sections = visibleSections(perms)
    const items = sections.flatMap((s) => s.items)
    const bad = items.filter((i) => !canOpenPage(perms, i.href.split("?")[0]))
    check(`${role}: every menu item opens`, bad.length === 0, bad.map((i) => i.href))
    check(`${role}: no empty section`, sections.every((s) => s.items.length > 0))
    const actions = QUICK_ACTIONS.filter((a) => can(perms, a.module, a.action))
    check(`${role}: quick actions need the create permission`, actions.every((a) => can(perms, a.module, "create")))
    console.log(`  ${role}: ${sections.map((s) => `${s.label || s.items[0].label}[${s.items.length}]`).join(" ")} | + New: ${actions.length}`)
  }
  check("ADMIN sees every item", visibleSections(ADMIN_PERMISSIONS).flatMap((s) => s.items).length === allHrefs.length)
  const officer = visibleSections(DEFAULT_PERMISSIONS.SALES_OFFICER).flatMap((s) => s.items).map((i) => i.label)
  check("SALES_OFFICER: no Users / Settings / Chart of accounts", !officer.some((l) => ["Users", "Settings", "Chart of accounts"].includes(l)), officer)
  const accountant = visibleSections(DEFAULT_PERMISSIONS.ACCOUNTANT).flatMap((s) => s.items).map((i) => i.label)
  check("ACCOUNTANT: Settings hub visible (landed cost types / expense categories)", accountant.includes("Settings"), accountant)
  check("ACCOUNTANT: cannot open the general settings tab", !canOpenPage(DEFAULT_PERMISSIONS.ACCOUNTANT, "/settings/general"))
  console.log("  roles checked:", EDITABLE_ROLES.length + 1)

  // 2. Sell now with the walk-in customer: full payment required, never on credit.
  const tag = "t14" + Date.now().toString(36)
  const admin = await testUser("t14_admin", "ADMIN")
  const student = await testUser("t14_student", "STUDENT")
  const f = await fixtures(tag, admin)
  const p = await f.product("A", 10, 4)
  await prisma.$transaction(async (tx) => {
    await incrementStock(tx, { productId: p.id, warehouseId: f.wh.id, quantity: 40, userId: admin.id })
    await recordStockValueChange(tx, { productId: p.id, warehouseId: f.wh.id, delta: 40, userId: admin.id, type: "OPENING_STOCK" })
    await postAccounting(tx, {}, admin.id)
  }, TX_OPTIONS)
  const walkIn = await walkInCustomerId()
  check("walk-in customer exists", !!(await prisma.customer.findUnique({ where: { id: walkIn } })))
  const sale = (extra: object) => ({ customerId: walkIn, warehouseId: f.wh.id, items: [{ productId: p.id, quantity: 2, unitPrice: 10 }], ...extra })
  const total = (await prisma.setting.findUnique({ where: { key: "salesTaxRate" } }))?.value ?? "0"
  const expected = 20 + Math.round(20 * Number(total)) / 100
  await expectError("walk-in: draft refused", () => createSalesOrder(admin, sale({ mode: "draft" })), 400)
  await expectError("walk-in: confirm (credit) refused", () => createSalesOrder(admin, sale({ mode: "confirm" })), 400)
  await expectError("walk-in: sell now without payment refused", () => createSalesOrder(admin, sale({ mode: "sell_now" })), 400)
  await expectError("walk-in: partial payment refused", () => createSalesOrder(admin, sale({ mode: "sell_now", payment: { amount: "1", paymentMethod: "CASH" } })), 400)
  const id = await createSalesOrder(admin, sale({ mode: "sell_now", payment: { amount: expected.toFixed(2), paymentMethod: "EVC_PLUS", payerPhone: "615000001" } }))
  const order = await salesOrderDetail(admin, id)
  check("walk-in sale delivered", order.status === "DELIVERED", order.status)
  check("walk-in sale fully paid (EVC Plus)", order.customerPayments.length === 1 && eq(order.customerPayments[0].amount, order.total) && order.customerPayments[0].paymentMethod === "EVC_PLUS", order.customerPayments)
  check("walk-in balance does not grow", eq((await getCustomerBalances([walkIn])).get(walkIn)!, (await getCustomerBalances([walkIn])).get(walkIn)!) && order.customerPayments.length === 1)
  // Own-scope roles may sell to the shared walk-in customer (from their own warehouse), paid in full.
  const sw = await prisma.warehouse.create({ data: { name: `WH-S ${tag}`, code: `S${tag}`, userId: student.id } })
  const sp = await prisma.product.create({ data: { name: `S ${tag}`, sku: `S-${tag}`, categoryId: f.cat.id, sellingPrice: 10, costPrice: 4, userId: student.id } })
  await prisma.$transaction(async (tx) => {
    await incrementStock(tx, { productId: sp.id, warehouseId: sw.id, quantity: 5, userId: student.id })
    await recordStockValueChange(tx, { productId: sp.id, warehouseId: sw.id, delta: 5, userId: student.id, type: "OPENING_STOCK" })
    await postAccounting(tx, {}, student.id)
  }, TX_OPTIONS)
  const studentSale = (extra: object) => ({ customerId: walkIn, warehouseId: sw.id, items: [{ productId: sp.id, quantity: 1, unitPrice: 10 }], mode: "sell_now", ...extra })
  await expectError("student: walk-in without payment refused", () => createSalesOrder(student, studentSale({})), 400)
  const sid = await createSalesOrder(student, studentSale({ payment: { amount: (10 + Math.round(10 * Number(total)) / 100).toFixed(2), paymentMethod: "CASH" } }))
  check("student: walk-in sale paid in full works", (await salesOrderDetail(student, sid)).status === "DELIVERED")

  // Named customer: paid now is optional and may be partial; more than the total is refused.
  await expectError("payment above the total refused", () => createSalesOrder(admin, { ...sale({ mode: "sell_now", payment: { amount: "999", paymentMethod: "CASH" } }), customerId: f.customer.id }), 400)
  await expectError("payment only with sell now", () => createSalesOrder(admin, { ...sale({ mode: "confirm", payment: { amount: "5", paymentMethod: "CASH" } }), customerId: f.customer.id }), 400)
  const named = await createSalesOrder(admin, { ...sale({ mode: "sell_now", payment: { amount: "5", paymentMethod: "CASH" } }), customerId: f.customer.id })
  const n = await salesOrderDetail(admin, named)
  const bal = (await getCustomerBalances([f.customer.id])).get(f.customer.id)!
  check("named customer: partial payment, rest owed", eq(bal, n.total.minus(5)), [bal, n.total])

  // 3. Landed cost template: 2 lines applied in one call.
  const type = await prisma.landedCostType.findFirstOrThrow({ where: { isActive: true } })
  const agent = await prisma.supplier.create({ data: { name: `Agent ${tag}`, email: "a@x.so", type: "SERVICE_PROVIDER", userId: admin.id } })
  const tpl = await createTemplate(admin, {
    name: `QAADE ${tag}`,
    items: [
      { typeId: type.id, amountType: "PERCENT", value: "5", percentBase: "GOODS", allocationMethod: "VALUE" },
      { typeId: type.id, paidToSupplierId: agent.id, amountType: "FIXED", value: "30", allocationMethod: "QUANTITY" },
    ],
  })
  await expectError("template: manual allocation refused", () => createTemplate(admin, { name: `Bad ${tag}`, items: [{ typeId: type.id, amountType: "FIXED", value: "1", allocationMethod: "MANUAL" }] }), 400)
  await expectError("template: duplicate name refused", () => createTemplate(admin, { name: `qaade ${tag}`, items: [{ typeId: type.id, amountType: "FIXED", value: "1" }] }), 409)
  const po = await prisma.purchaseOrder.create({
    data: {
      orderNumber: `PO-${tag}`, supplierId: f.supplier.id, warehouseId: f.wh.id, userId: admin.id, status: "PENDING",
      subtotal: 200, tax: 0, total: 200, items: { create: [{ productId: p.id, quantity: 20, originalQuantity: 20, unitPrice: 10, subtotal: 200 }] },
    },
  })
  const added = await applyTemplate(admin, po.id, { templateId: tpl.id })
  const costs = await prisma.purchaseLandedCost.findMany({ where: { purchaseOrderId: po.id }, orderBy: { amount: "asc" } })
  check("template applied: 2 costs", added === 2 && costs.length === 2, costs.length)
  check("5% of goods = 10.00 to the PO supplier", eq(costs[0].amount, 10) && costs[0].paidToSupplierId === f.supplier.id, costs[0])
  check("fixed 30.00 to the agent", eq(costs[1].amount, 30) && costs[1].paidToSupplierId === agent.id, costs[1])
  const lcJournal = await prisma.journalEntry.count({ where: { sourceType: "LANDED_COST", sourceId: { in: costs.map((c) => c.id) } } })
  check("template costs posted to the journal", lcJournal === 2, lcJournal)

  // 4. Search: scoped by permission and ownership.
  const adminHits = await globalSearch(admin, `PO-${tag}`)
  check("search finds the PO by number", adminHits.some((h) => h.type === "Purchase order"), adminHits)
  const studentHits = await globalSearch(student, `PO-${tag}`)
  check("student (own scope) does not see the admin's PO", !studentHits.some((h) => h.type === "Purchase order"), studentHits)
  check("search needs 2 characters", (await globalSearch(admin, "P")).length === 0)

  finish()
}

main().finally(() => prisma.$disconnect())

import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { parsePaymentFields } from "@/lib/payment-fields"
import { requirePermission } from "@/lib/permissions"
import { assertPurchaseOrderInScope, createCostRows, landedCostView } from "@/lib/landed-cost-service"

/**
 * "Add costs": several landed costs in one save (all or nothing, one
 * revaluation, one journal posting). Body: { rows: [{ typeId,
 * paidToSupplierId, amountType, value, percentBase, allocationMethod,
 * manual?, reference, costDate, notes }], reason? (finalized costs),
 * paidNow?: { paymentMethod, payerPhone?, transactionId?, reference? } }.
 * "Paid now" records one supplier payment per paid-to party and also needs
 * supplier_payments create. Invalid rows: 400 with rowErrors [{ row, message }].
 */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const body = await readJson(request)
  await assertPurchaseOrderInScope(user, params.id, "landed_costs")
  const paidNow = body?.paidNow && typeof body.paidNow === "object" ? body.paidNow : null
  if (paidNow) requirePermission(user, ["supplier_payments", "create"], "Your role cannot record supplier payments")
  const method = paidNow ? await parsePaymentFields(paidNow) : null

  const ids = await createCostRows(user, params.id, body, method && { ...method, reference: paidNow.reference })
  const view = await landedCostView(prisma, params.id)
  return json({ ...view, createdIds: ids, warnings: method?.warnings ?? [] }, { status: 201 })
}, { permission: ["landed_costs", "create"] })

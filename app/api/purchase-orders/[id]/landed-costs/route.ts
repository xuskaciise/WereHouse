import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { parsePaymentFields } from "@/lib/payment-fields"
import { HttpError } from "@/lib/auth-guard"
import { requirePermission } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import { parseLandedCostInput } from "@/lib/landed-costs"
import {
  assertCostsEditable,
  assertPurchaseOrderInScope,
  createLandedCostInTx,
  landedCostView,
  lockPurchaseOrder,
} from "@/lib/landed-cost-service"
import { postAccounting } from "@/lib/accounting"

// Additional (landed) costs of a purchase order. See lib/landed-costs.ts.

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  await assertPurchaseOrderInScope(user, params.id, "landed_costs")
  return json(await landedCostView(prisma, params.id))
}, { permission: ["landed_costs", "view"] })

/**
 * Body: { typeId, paidToSupplierId, amountType, value, percentBase,
 *         allocationMethod, manual?: [{ itemId, amount }], reference, costDate,
 *         notes, reason? (required once finalized),
 *         paidNow?: { paymentMethod, reference? } (records the payment too) }
 */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const purchaseOrderId = params.id
  const body = await readJson(request)
  await assertPurchaseOrderInScope(user, purchaseOrderId, "landed_costs")
  const input = parseLandedCostInput(body)
  await assertCanReference(user, { supplierId: input.paidToSupplierId })
  const type = await prisma.landedCostType.findUnique({ where: { id: input.typeId } })
  if (!type || !type.isActive) throw new HttpError(400, "Choose an active cost type")
  const paidNow = body.paidNow && typeof body.paidNow === "object" ? body.paidNow : null
  if (paidNow) {
    requirePermission(user, ["supplier_payments", "create"], "Your role cannot record supplier payments")
  }
  const paidMethod = paidNow ? await parsePaymentFields(paidNow) : null

  const costId = await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, purchaseOrderId)
    const reason = assertCostsEditable(user, po, body.reason)
    const id = await createLandedCostInTx(tx, user.id, purchaseOrderId, input, { reason, typeName: type.name, paidNow: paidNow && { ...paidMethod!, reference: paidNow.reference } })
    await postAccounting(tx, {}, user.id)
    return id
  }, TX_OPTIONS)

  const view = await landedCostView(prisma, purchaseOrderId)
  return json({ ...view, createdId: costId, warnings: paidMethod?.warnings ?? [] }, { status: 201 })
}, { permission: ["landed_costs", "create"] })

import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { requirePermission } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import {
  assertManualMatches,
  inputToPlanCost,
  loadForPlanning,
  parseLandedCostInput,
  planLandedCosts,
  syncLandedCosts,
  toPlanCost,
  toPlanItems,
} from "@/lib/landed-costs"
import {
  assertCostsEditable,
  assertPurchaseOrderInScope,
  costSnapshot,
  landedCostView,
  lockPurchaseOrder,
  logLandedCost,
} from "@/lib/landed-cost-service"

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
    if (typeof paidNow.paymentMethod !== "string" || !paidNow.paymentMethod) {
      throw new HttpError(400, "Payment method is required to mark the cost as paid")
    }
  }

  const costId = await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, purchaseOrderId)
    const reason = assertCostsEditable(user, po, body.reason)

    // Amount of the new line with the current quantities (and manual check).
    const loaded = await loadForPlanning(tx, purchaseOrderId)
    const items = toPlanItems(loaded)
    const plan = planLandedCosts(items, [...loaded.landedCosts.map(toPlanCost), inputToPlanCost("__new__", input)])
    const amount = plan.costs.find((c) => c.id === "__new__")!.amount
    assertManualMatches(input, items, amount)

    const cost = await tx.purchaseLandedCost.create({
      data: {
        purchaseOrderId,
        typeId: input.typeId,
        paidToSupplierId: input.paidToSupplierId,
        amountType: input.amountType,
        value: input.value,
        percentBase: input.percentBase,
        amount,
        allocationMethod: input.allocationMethod,
        reference: input.reference,
        costDate: input.costDate,
        notes: input.notes,
        userId: user.id,
        ...(input.manual && {
          allocations: {
            create: [...input.manual].map(([itemId, manualAmount]) => ({
              purchaseOrderItemId: itemId,
              manualAmount,
              amount: manualAmount,
            })),
          },
        }),
      },
    })
    await syncLandedCosts(tx, purchaseOrderId, user.id)

    if (paidNow) {
      await tx.supplierPayment.create({
        data: {
          supplierId: input.paidToSupplierId,
          landedCostId: cost.id,
          amount,
          paymentMethod: paidNow.paymentMethod,
          reference: typeof paidNow.reference === "string" ? paidNow.reference.trim() || null : input.reference,
          notes: `Landed cost: ${type.name}`,
          userId: user.id,
        },
      })
    }
    await logLandedCost(tx, {
      purchaseOrderId,
      userId: user.id,
      action: "CREATE",
      landedCostId: cost.id,
      after: await costSnapshot(tx, cost.id),
      reason,
    })
    return cost.id
  }, TX_OPTIONS)

  const view = await landedCostView(prisma, purchaseOrderId)
  return json({ ...view, createdId: costId }, { status: 201 })
}, { permission: ["landed_costs", "create"] })

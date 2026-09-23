import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
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

type Params = { id: string; costId: string }

async function findCost(purchaseOrderId: string, costId: string) {
  const cost = await prisma.purchaseLandedCost.findFirst({ where: { id: costId, purchaseOrderId } })
  if (!cost) throw new HttpError(404, "Cost not found")
  return cost
}

/** Same body as POST .../landed-costs (all fields), plus reason once finalized. */
export const PATCH = withAuth<Params>(async (request, { user, params }) => {
  const { id: purchaseOrderId, costId } = params
  const body = await readJson(request)
  await assertPurchaseOrderInScope(user, purchaseOrderId, "landed_costs")
  const existing = await findCost(purchaseOrderId, costId)
  const input = parseLandedCostInput(body)
  await assertCanReference(user, { supplierId: input.paidToSupplierId })
  const type = await prisma.landedCostType.findUnique({ where: { id: input.typeId } })
  // An inactive type may stay on a line that already uses it.
  if (!type || (!type.isActive && type.id !== existing.typeId)) throw new HttpError(400, "Choose an active cost type")

  await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, purchaseOrderId)
    const reason = assertCostsEditable(user, po, body.reason)
    const before = await costSnapshot(tx, costId)

    const loaded = await loadForPlanning(tx, purchaseOrderId)
    const items = toPlanItems(loaded)
    const others = loaded.landedCosts.filter((c) => c.id !== costId).map(toPlanCost)
    const amount = planLandedCosts(items, [...others, inputToPlanCost(costId, input)]).costs.find((c) => c.id === costId)!.amount
    assertManualMatches(input, items, amount)

    // Allocations are rebuilt by syncLandedCosts; manual amounts are the input.
    await tx.purchaseLandedCostAllocation.deleteMany({ where: { landedCostId: costId } })
    await tx.purchaseLandedCost.update({
      where: { id: costId },
      data: {
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
    await logLandedCost(tx, {
      purchaseOrderId,
      userId: user.id,
      action: "UPDATE",
      landedCostId: costId,
      before,
      after: await costSnapshot(tx, costId),
      reason,
    })
  }, TX_OPTIONS)

  return json(await landedCostView(prisma, purchaseOrderId))
}, { permission: ["landed_costs", "edit"] })

/** Body (optional): { reason } - required once finalized. Paid costs cannot be deleted. */
export const DELETE = withAuth<Params>(async (request, { user, params }) => {
  const { id: purchaseOrderId, costId } = params
  const body = await request.json().catch(() => ({}))
  await assertPurchaseOrderInScope(user, purchaseOrderId, "landed_costs")
  await findCost(purchaseOrderId, costId)

  await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, purchaseOrderId)
    const reason = assertCostsEditable(user, po, body?.reason)
    const payments = await tx.supplierPayment.count({ where: { landedCostId: costId } })
    if (payments > 0) {
      throw new HttpError(409, "This cost has payments recorded against it; delete or re-link the payments first")
    }
    const before = await costSnapshot(tx, costId)
    await tx.purchaseLandedCost.delete({ where: { id: costId } })
    await syncLandedCosts(tx, purchaseOrderId, user.id)
    await logLandedCost(tx, { purchaseOrderId, userId: user.id, action: "DELETE", landedCostId: costId, before, reason })
  }, TX_OPTIONS)

  return json(await landedCostView(prisma, purchaseOrderId))
}, { permission: ["landed_costs", "delete"] })

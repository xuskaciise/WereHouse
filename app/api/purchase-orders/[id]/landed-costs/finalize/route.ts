import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, isAdmin } from "@/lib/auth-guard"
import { assertPurchaseOrderInScope, landedCostView, lockPurchaseOrder, logLandedCost } from "@/lib/landed-cost-service"

/**
 * Body: { finalized: true } marks the PO's costs as final (landed_costs_admin
 * edit, scoped like the PO). { finalized: false, reason } reopens them:
 * ADMIN only, with a reason. Both are logged.
 */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const purchaseOrderId = params.id
  const body = await readJson(request)
  if (typeof body?.finalized !== "boolean") throw new HttpError(400, "finalized must be true or false")
  await assertPurchaseOrderInScope(user, purchaseOrderId, "landed_costs_admin")
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null

  await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, purchaseOrderId)
    if (body.finalized) {
      if (po.costsFinalizedAt) throw new HttpError(409, "Costs are already finalized")
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { costsFinalizedAt: new Date(), costsFinalizedById: user.id },
      })
      await logLandedCost(tx, { purchaseOrderId, userId: user.id, action: "FINALIZE", reason })
    } else {
      if (!po.costsFinalizedAt) throw new HttpError(409, "Costs are not finalized")
      if (!isAdmin(user)) throw new HttpError(403, "Only an admin can reopen finalized costs")
      if (!reason) throw new HttpError(400, "A reason is required to reopen finalized costs")
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { costsFinalizedAt: null, costsFinalizedById: null },
      })
      await logLandedCost(tx, { purchaseOrderId, userId: user.id, action: "REOPEN", reason })
    }
  }, TX_OPTIONS)

  return json(await landedCostView(prisma, purchaseOrderId))
}, { permission: ["landed_costs_admin", "edit"] })

import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import {
  addEvent,
  assertTransferCostsEditable,
  assertTransferInScope,
  lockTransfer,
  parseTransferCostInput,
  syncTransferCosts,
  transferCostSnapshot,
  transferDetail,
} from "@/lib/stock-transfers"

type Params = { id: string; costId: string }

async function findCost(stockTransferId: string, costId: string) {
  const cost = await prisma.stockTransferCost.findFirst({ where: { id: costId, stockTransferId } })
  if (!cost) throw new HttpError(404, "Cost not found")
  return cost
}

// Same body as POST .../costs (reason required once RECEIVED, admin only).
export const PATCH = withAuth<Params>(async (request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  const existing = await findCost(params.id, params.costId)
  const body = await readJson(request)
  const input = parseTransferCostInput(body)
  await assertCanReference(user, { supplierId: input.paidToSupplierId })
  const type = await prisma.landedCostType.findUnique({ where: { id: input.typeId } })
  if (!type || (!type.isActive && type.id !== existing.typeId)) throw new HttpError(400, "Choose an active cost type")

  await prisma.$transaction(async (tx) => {
    const t = await lockTransfer(tx, params.id)
    const reason = assertTransferCostsEditable(user, t, body.reason)
    const before = await transferCostSnapshot(tx, params.costId)
    await tx.stockTransferCost.update({ where: { id: params.costId }, data: input })
    await syncTransferCosts(tx, t.id, user.id)
    await addEvent(tx, {
      stockTransferId: t.id,
      type: "COST_UPDATED",
      userId: user.id,
      notes: reason,
      data: { before, after: await transferCostSnapshot(tx, params.costId) },
    })
  }, TX_OPTIONS)
  return json(await transferDetail(params.id))
}, { permission: ["stock_transfers", "edit"] })

// Body (optional): { reason }. Paid costs cannot be deleted.
export const DELETE = withAuth<Params>(async (request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  await findCost(params.id, params.costId)
  const body = await request.json().catch(() => ({}))
  await prisma.$transaction(async (tx) => {
    const t = await lockTransfer(tx, params.id)
    const reason = assertTransferCostsEditable(user, t, body?.reason)
    if ((await tx.supplierPayment.count({ where: { stockTransferCostId: params.costId } })) > 0) {
      throw new HttpError(409, "This cost has payments recorded against it")
    }
    const before = await transferCostSnapshot(tx, params.costId)
    await tx.stockTransferCost.delete({ where: { id: params.costId } })
    await syncTransferCosts(tx, t.id, user.id)
    await addEvent(tx, { stockTransferId: t.id, type: "COST_DELETED", userId: user.id, notes: reason, data: { before } })
  }, TX_OPTIONS)
  return json(await transferDetail(params.id))
}, { permission: ["stock_transfers", "edit"] })

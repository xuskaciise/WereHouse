import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { addEvent, assertTransferInScope, lockTransfer, parseTransferInput, transferDetail } from "@/lib/stock-transfers"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  return json(await transferDetail(params.id))
}, { permission: ["stock_transfers", "view"] })

// Edit a DRAFT (warehouses, items, expected date, notes). Same body as POST.
export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  const input = parseTransferInput(await readJson(request))
  await assertCanReference(user, { warehouseId: input.fromWarehouseId, productIds: input.items.map((i) => i.productId) })
  await assertCanReference(user, { warehouseId: input.toWarehouseId })

  await prisma.$transaction(async (tx) => {
    const t = await lockTransfer(tx, params.id)
    if (t.status !== "DRAFT") throw new HttpError(400, "Only a draft transfer can be edited")
    await tx.stockTransferItem.deleteMany({ where: { stockTransferId: t.id } })
    await tx.stockTransfer.update({
      where: { id: t.id },
      data: {
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        expectedDate: input.expectedDate,
        notes: input.notes,
        items: { create: input.items },
      },
    })
    await addEvent(tx, { stockTransferId: t.id, type: "DRAFT_UPDATED", userId: user.id })
  }, TX_OPTIONS)

  return json(await transferDetail(params.id))
}, { permission: ["stock_transfers", "edit"] })

// Only drafts (without costs) can be deleted; anything else is cancelled instead.
export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  await prisma.$transaction(async (tx) => {
    const t = await lockTransfer(tx, params.id)
    if (t.status !== "DRAFT") throw new HttpError(400, "Only a draft can be deleted; cancel the transfer instead")
    if (t.costs.length > 0) throw new HttpError(409, "Delete the transfer costs first")
    await tx.stockTransfer.delete({ where: { id: t.id } })
  }, TX_OPTIONS)
  return json({ success: true })
}, { permission: ["stock_transfers", "delete"] })

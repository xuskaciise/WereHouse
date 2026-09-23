import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { parseQuantity } from "@/lib/stock"
import {
  parseReason,
  purchaseOrderDetailInclude,
  recalculatePurchaseOrderTotals,
  setItemQuantity,
} from "@/lib/purchase-orders"

/**
 * Edits line quantities while the order is still PENDING and nothing has
 * been received. After the first receive, quantities change only through the
 * receive dialog (over-receive / close remaining).
 *
 * Body: { items: [{ id, quantity }], reason?: string }
 */
export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  const purchaseOrderId = params.id
  const body = (await readJson(request)) as { items?: { id?: unknown; quantity?: unknown }[]; reason?: unknown }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, "items array with at least one entry is required")
  }
  const requested = new Map<string, number>()
  for (const row of body.items) {
    if (!row || typeof row.id !== "string" || !row.id) throw new HttpError(400, "Each item needs an id")
    if (requested.has(row.id)) throw new HttpError(400, "Each line item may appear only once")
    requested.set(row.id, parseQuantity(row.quantity))
  }
  const reason = parseReason(body.reason, { required: false, label: "the edit" })

  const baseWhere = { id: purchaseOrderId, ...ownershipWhere(user) }
  const exists = await prisma.purchaseOrder.count({ where: baseWhere })
  if (!exists) throw new HttpError(404, "Purchase order not found")

  await prisma.$transaction(async (tx) => {
    // Same lock as receiving, so an edit and a first receive cannot interleave.
    await tx.$queryRaw`SELECT "id" FROM "purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`

    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { items: true, _count: { select: { receives: true } } },
    })
    if (po.status !== "PENDING" || po._count.receives > 0) {
      throw new HttpError(409, "Quantities can only be edited before any goods are received; use Receive instead")
    }

    const itemById = new Map(po.items.map((i) => [i.id, i]))
    let changed = 0
    for (const [itemId, quantity] of requested) {
      const item = itemById.get(itemId)
      if (!item) throw new HttpError(400, "Invalid purchase order item")
      if (item.quantity === quantity) continue
      await setItemQuantity(tx, item, quantity)
      await tx.purchaseOrderItemAdjustment.create({
        data: {
          purchaseOrderItemId: item.id,
          type: "EDIT",
          oldQuantity: item.quantity,
          newQuantity: quantity,
          reason,
          userId: user.id,
        },
      })
      changed++
    }
    if (changed === 0) throw new HttpError(400, "No quantities were changed")

    await recalculatePurchaseOrderTotals(tx, po.id)
  }, TX_OPTIONS)

  const updated = await prisma.purchaseOrder.findFirst({ where: baseWhere, include: purchaseOrderDetailInclude })
  return json(updated)
})

import type { PurchaseAdjustmentType } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { requirePermission, scopeWhere } from "@/lib/permissions"
import { incrementStock, parseQuantity } from "@/lib/stock"
import {
  parseReason,
  purchaseOrderDetailInclude,
  recalculatePurchaseOrderTotals,
  recomputePurchaseOrderStatus,
  setItemQuantity,
  totalReceived,
} from "@/lib/purchase-orders"

interface ReceiveLineInput {
  purchaseOrderItemId?: unknown
  quantityReceived?: unknown
  closeRemaining?: unknown
  reason?: unknown
}

interface RequestedLine {
  quantity: number
  closeRemaining: boolean
  reason: unknown
}

/**
 * Receives goods for a purchase order. Per line the quantity may be:
 *  - up to the remaining quantity (normal / partial receive, any role that
 *    can see the order),
 *  - more than remaining (over-delivery: the line quantity grows to the total
 *    received), or
 *  - less than remaining with closeRemaining (the supplier will not deliver
 *    the rest: the line quantity shrinks to the total received, possibly 0).
 * The last two need ADMIN/WAREHOUSE_MANAGER and a reason. Receive record,
 * stock, movements, line quantities, PO totals and status change in one
 * transaction; totals are recomputed here, never taken from the client.
 */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const purchaseOrderId = params.id
  const { lines, notes } = (await readJson(request)) as { lines?: ReceiveLineInput[]; notes?: unknown }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, "lines array with at least one entry is required")
  }

  const requested = new Map<string, RequestedLine>()
  for (const row of lines) {
    if (!row || typeof row.purchaseOrderItemId !== "string" || !row.purchaseOrderItemId) {
      throw new HttpError(400, "Each line needs a purchaseOrderItemId")
    }
    if (requested.has(row.purchaseOrderItemId)) throw new HttpError(400, "Each line item may appear only once")
    const quantity = parseQuantity(row.quantityReceived ?? 0, { allowZero: true })
    const closeRemaining = row.closeRemaining === true
    if (quantity === 0 && !closeRemaining) continue
    requested.set(row.purchaseOrderItemId, { quantity, closeRemaining, reason: row.reason })
  }
  if (requested.size === 0) {
    throw new HttpError(400, "Enter at least one quantity greater than zero to receive, or close a remainder")
  }

  const receiveNotes = parseReason(notes, { required: false, label: "the receive" })

  const baseWhere = { id: purchaseOrderId, ...scopeWhere(user, "purchase_receive") }
  const exists = await prisma.purchaseOrder.count({ where: baseWhere })
  if (!exists) throw new HttpError(404, "Purchase order not found")

  await prisma.$transaction(async (tx) => {
    // Lock the order so concurrent receives are serialised and the
    // remaining-quantity checks below cannot be raced.
    await tx.$queryRaw`SELECT "id" FROM "purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`

    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { items: { include: { receiveItems: true, product: { select: { name: true } } } } },
    })

    if (po.status === "CANCELLED") {
      throw new HttpError(400, "Cannot receive goods for a cancelled purchase order")
    }
    if (po.status !== "PENDING" && po.status !== "PARTIALLY_RECEIVED") {
      throw new HttpError(400, "This purchase order cannot be received in its current status")
    }

    const itemById = new Map(po.items.map((i) => [i.id, i]))
    const plan: {
      item: (typeof po.items)[number]
      quantity: number
      newItemQuantity: number
      adjustment: { type: PurchaseAdjustmentType; reason: string } | null
    }[] = []

    for (const [itemId, line] of requested) {
      const item = itemById.get(itemId)
      if (!item) throw new HttpError(400, "Invalid purchase order item")
      const name = item.product.name
      if (item.closed) throw new HttpError(400, `${name} is closed; no more goods can be received for it`)

      const receivedAfter = totalReceived(item) + line.quantity
      let adjustment: { type: PurchaseAdjustmentType; reason: string } | null = null
      let newItemQuantity = item.quantity

      if (receivedAfter > item.quantity) {
        requirePermission(user, ["purchase_receive", "edit"], "You are not allowed to receive more than ordered")
        const reason = parseReason(line.reason, { required: true, label: `receiving more ${name} than ordered` })!
        adjustment = { type: "OVER_RECEIVE", reason }
        newItemQuantity = receivedAfter
      } else if (line.closeRemaining && receivedAfter < item.quantity) {
        requirePermission(user, ["purchase_receive", "edit"], "You are not allowed to close a remaining quantity")
        const reason = parseReason(line.reason, { required: true, label: `closing the remainder of ${name}` })!
        adjustment = { type: "CLOSE_REMAINING", reason }
        newItemQuantity = receivedAfter
      } else if (line.quantity === 0) {
        // "Close" on a line that is already complete: nothing to do.
        continue
      }

      plan.push({ item, quantity: line.quantity, newItemQuantity, adjustment })
    }

    if (plan.length === 0) {
      throw new HttpError(400, "Nothing to receive: every selected line is already complete")
    }

    const receive = await tx.purchaseReceive.create({
      data: {
        purchaseOrderId: po.id,
        userId: user.id,
        notes: receiveNotes,
        items: {
          create: plan.map((p) => ({ purchaseOrderItemId: p.item.id, quantityReceived: p.quantity })),
        },
      },
    })

    for (const p of plan) {
      if (p.quantity > 0) {
        await incrementStock(tx, {
          productId: p.item.productId,
          warehouseId: po.warehouseId,
          quantity: p.quantity,
          userId: user.id,
        })
        await tx.stockMovement.create({
          data: {
            productId: p.item.productId,
            warehouseId: po.warehouseId,
            type: "IN",
            quantity: p.quantity,
            reference: po.orderNumber,
            referenceId: receive.id,
            notes:
              p.adjustment?.type === "OVER_RECEIVE"
                ? `Purchase receive for ${po.orderNumber} (over-delivery: ${p.adjustment.reason})`
                : `Purchase receive for ${po.orderNumber}`,
            userId: user.id,
          },
        })
      }

      if (p.adjustment) {
        await setItemQuantity(tx, p.item, p.newItemQuantity, {
          closed: p.adjustment.type === "CLOSE_REMAINING",
        })
        await tx.purchaseOrderItemAdjustment.create({
          data: {
            purchaseOrderItemId: p.item.id,
            purchaseReceiveId: receive.id,
            type: p.adjustment.type,
            oldQuantity: p.item.quantity,
            newQuantity: p.newItemQuantity,
            reason: p.adjustment.reason,
            userId: user.id,
          },
        })
      }
    }

    if (plan.some((p) => p.adjustment)) await recalculatePurchaseOrderTotals(tx, po.id)
    await recomputePurchaseOrderStatus(tx, po.id)
  }, TX_OPTIONS)

  const updated = await prisma.purchaseOrder.findFirst({ where: baseWhere, include: purchaseOrderDetailInclude })
  return json(updated)
}, { permission: ["purchase_receive", "create"] })

import type { OrderStatus, Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { incrementStock } from "@/lib/stock"

async function recomputePurchaseOrderStatus(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    include: { receiveItems: true },
  })

  let allComplete = items.length > 0
  let anyReceived = false

  for (const item of items) {
    const received = item.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)
    if (received < item.quantity) allComplete = false
    if (received > 0) anyReceived = true
  }

  const status: OrderStatus = allComplete ? "CONFIRMED" : anyReceived ? "PARTIALLY_RECEIVED" : "PENDING"

  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status },
  })
}

const orderDetailInclude = {
  supplier: true,
  warehouse: true,
  user: { select: { id: true, name: true, username: true } },
  items: { include: { product: true, receiveItems: true } },
  receives: {
    orderBy: { createdAt: "desc" as const },
    include: {
      user: { select: { id: true, name: true, username: true } },
      items: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude

export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const purchaseOrderId = params.id
  const { lines, notes } = (await readJson(request)) as {
    lines?: { purchaseOrderItemId: string; quantityReceived: number }[]
    notes?: string | null
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, "lines array with at least one entry is required")
  }

  // Sum requested quantities per line item (ignoring zero rows).
  const requested = new Map<string, number>()
  for (const row of lines) {
    if (!row?.purchaseOrderItemId) continue
    const qty = Number(row.quantityReceived)
    if (!Number.isFinite(qty) || qty < 0) {
      throw new HttpError(400, "Each quantityReceived must be a non-negative number")
    }
    const floored = Math.floor(qty)
    if (floored === 0) continue
    requested.set(row.purchaseOrderItemId, (requested.get(row.purchaseOrderItemId) ?? 0) + floored)
  }
  if (requested.size === 0) {
    throw new HttpError(400, "Enter at least one quantity greater than zero to receive")
  }

  const baseWhere = { id: purchaseOrderId, ...ownershipWhere(user) }
  const exists = await prisma.purchaseOrder.count({ where: baseWhere })
  if (!exists) throw new HttpError(404, "Purchase order not found")

  await prisma.$transaction(async (tx) => {
    // Lock the order so concurrent receives are serialised and the
    // "remaining quantity" check below cannot be raced.
    await tx.$queryRaw`SELECT "id" FROM "purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`

    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { items: { include: { receiveItems: true } } },
    })

    if (po.status === "CANCELLED") {
      throw new HttpError(400, "Cannot receive goods for a cancelled purchase order")
    }
    if (po.status !== "PENDING" && po.status !== "PARTIALLY_RECEIVED") {
      throw new HttpError(400, "This purchase order cannot be received in its current status")
    }

    const itemById = new Map(po.items.map((i) => [i.id, i]))
    const normalized: { purchaseOrderItemId: string; productId: string; quantityReceived: number }[] = []
    for (const [itemId, qty] of requested) {
      const line = itemById.get(itemId)
      if (!line) throw new HttpError(400, "Invalid purchase order item")
      const alreadyReceived = line.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)
      if (alreadyReceived + qty > line.quantity) {
        throw new HttpError(
          400,
          `Cannot receive ${qty} more for a line item; only ${line.quantity - alreadyReceived} remaining`
        )
      }
      normalized.push({ purchaseOrderItemId: itemId, productId: line.productId, quantityReceived: qty })
    }

    const receive = await tx.purchaseReceive.create({
      data: {
        purchaseOrderId: po.id,
        userId: user.id,
        notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
        items: {
          create: normalized.map((n) => ({
            purchaseOrderItemId: n.purchaseOrderItemId,
            quantityReceived: n.quantityReceived,
          })),
        },
      },
    })

    for (const n of normalized) {
      await incrementStock(tx, {
        productId: n.productId,
        warehouseId: po.warehouseId,
        quantity: n.quantityReceived,
        userId: user.id,
      })
      await tx.stockMovement.create({
        data: {
          productId: n.productId,
          warehouseId: po.warehouseId,
          type: "IN",
          quantity: n.quantityReceived,
          reference: po.orderNumber,
          referenceId: receive.id,
          notes: `Purchase receive for ${po.orderNumber}`,
          userId: user.id,
        },
      })
    }

    await recomputePurchaseOrderStatus(tx, po.id)
  }, TX_OPTIONS)

  const updated = await prisma.purchaseOrder.findFirst({
    where: baseWhere,
    include: orderDetailInclude,
  })
  return json(updated)
})

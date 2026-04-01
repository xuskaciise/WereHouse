import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser, ownershipWhere } from "@/lib/rbac"
import type { Prisma } from "@prisma/client"
import type { OrderStatus } from "@prisma/client"

async function recomputePurchaseOrderStatus(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string
) {
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

  const status: OrderStatus = allComplete
    ? "CONFIRMED"
    : anyReceived
      ? "PARTIALLY_RECEIVED"
      : "PENDING"

  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status },
  })
}

const orderDetailInclude = {
  supplier: true,
  warehouse: true,
  user: {
    select: {
      id: true,
      name: true,
      username: true,
    },
  },
  items: {
    include: {
      product: true,
      receiveItems: true,
    },
  },
  receives: {
    orderBy: { createdAt: "desc" as const },
    include: {
      user: {
        select: { id: true, name: true, username: true },
      },
      items: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: purchaseOrderId } = await params
    if (!purchaseOrderId) {
      return NextResponse.json({ error: "Invalid purchase order id" }, { status: 400 })
    }

    const body = await request.json()
    const { lines, notes } = body as {
      lines?: { purchaseOrderItemId: string; quantityReceived: number }[]
      notes?: string | null
    }

    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { error: "lines array with at least one entry is required" },
        { status: 400 }
      )
    }

    const baseWhere = { id: purchaseOrderId, ...ownershipWhere(currentUser) }
    const po = await prisma.purchaseOrder.findFirst({
      where: baseWhere,
      include: {
        items: {
          include: { receiveItems: true },
        },
      },
    })

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
    }

    if (po.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Cannot receive goods for a cancelled purchase order" },
        { status: 400 }
      )
    }

    if (po.status !== "PENDING" && po.status !== "PARTIALLY_RECEIVED") {
      return NextResponse.json(
        { error: "This purchase order cannot be received in its current status" },
        { status: 400 }
      )
    }

    const itemById = new Map(po.items.map((i) => [i.id, i]))
    const qtyByItemId = new Map<string, number>()

    for (const row of lines) {
      if (!row?.purchaseOrderItemId) continue
      const qty = Number(row.quantityReceived)
      if (!Number.isFinite(qty) || qty < 0) {
        return NextResponse.json(
          { error: "Each quantityReceived must be a non-negative number" },
          { status: 400 }
        )
      }
      if (qty === 0) continue

      const line = itemById.get(row.purchaseOrderItemId)
      if (!line) {
        return NextResponse.json(
          { error: `Invalid purchase order item: ${row.purchaseOrderItemId}` },
          { status: 400 }
        )
      }

      const floored = Math.floor(qty)
      qtyByItemId.set(line.id, (qtyByItemId.get(line.id) ?? 0) + floored)
    }

    const normalized: { purchaseOrderItemId: string; quantityReceived: number }[] = []
    for (const [purchaseOrderItemId, qty] of qtyByItemId) {
      if (qty <= 0) continue
      const line = itemById.get(purchaseOrderItemId)!
      const alreadyReceived = line.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)
      if (alreadyReceived + qty > line.quantity) {
        return NextResponse.json(
          {
            error: `Cannot receive ${qty} more for a line item; only ${line.quantity - alreadyReceived} remaining`,
          },
          { status: 400 }
        )
      }
      normalized.push({ purchaseOrderItemId, quantityReceived: qty })
    }

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "Enter at least one quantity greater than zero to receive" },
        { status: 400 }
      )
    }

    const orderNumber = po.orderNumber
    const warehouseId = po.warehouseId

    await prisma.$transaction(async (tx) => {
      const receive = await tx.purchaseReceive.create({
        data: {
          purchaseOrderId: po.id,
          userId: currentUser.id,
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
        const line = itemById.get(n.purchaseOrderItemId)!
        const productId = line.productId
        const purchasedQuantity = n.quantityReceived

        await tx.stock.upsert({
          where: {
            productId_warehouseId: {
              productId,
              warehouseId,
            },
          },
          update: {
            quantity: { increment: purchasedQuantity },
            status: "IN_STOCK",
            userId: currentUser.id,
          },
          create: {
            productId,
            warehouseId,
            quantity: purchasedQuantity,
            reservedQuantity: 0,
            status: "IN_STOCK",
            userId: currentUser.id,
          },
        })

        await tx.stockMovement.create({
          data: {
            productId,
            warehouseId,
            type: "IN",
            quantity: purchasedQuantity,
            reference: orderNumber,
            referenceId: receive.id,
            notes: `Purchase receive for ${orderNumber}`,
            userId: currentUser.id,
          },
        })
      }

      await recomputePurchaseOrderStatus(tx, po.id)
    })

    const updated = await prisma.purchaseOrder.findFirst({
      where: baseWhere,
      include: orderDetailInclude,
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    console.error("Error receiving purchase order:", error)
    return NextResponse.json(
      { error: error.message || "Failed to receive purchase order" },
      { status: 500 }
    )
  }
}

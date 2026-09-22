import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { calculateOrderTotals, parseOrderItems } from "@/lib/orders"

const purchaseOrderInclude = {
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

export const GET = withAuth(async (_request, { user }) => {
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: ownershipWhere(user),
    include: purchaseOrderInclude,
    orderBy: { createdAt: "desc" },
  })
  return json(purchaseOrders)
})

export const POST = withAuth(async (request, { user }) => {
  const body = await readJson(request)
  const { supplierId, warehouseId, expectedDelivery, notes } = body
  if (!supplierId || !warehouseId) {
    throw new HttpError(400, "Supplier, Warehouse, and at least one item are required")
  }
  const items = parseOrderItems(body.items)

  await assertCanReference(user, {
    supplierId,
    warehouseId,
    productIds: items.map((item) => item.productId),
  })

  const { subtotal, tax, discount, total } = calculateOrderTotals(items, "0.08") // 8% tax

  const orderCount = await prisma.purchaseOrder.count()
  const orderNumber = `PO-${String(orderCount + 1).padStart(6, "0")}`

  // Stock is only updated when goods are received (see .../receive), and the
  // supplier balance is derived from orders and payments (lib/balances.ts).
  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      orderNumber,
      supplierId,
      warehouseId,
      userId: user.id,
      expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : null,
      subtotal,
      tax,
      discount,
      total,
      status: "PENDING",
      notes: notes || null,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
      },
    },
    include: purchaseOrderInclude,
  })

  return json(purchaseOrder, { status: 201 })
})

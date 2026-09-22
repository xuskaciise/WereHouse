import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { parseOrderItems, parseOrderStatus } from "@/lib/orders"
import { decrementStock } from "@/lib/stock"

const salesOrderInclude = {
  customer: true,
  warehouse: true,
  user: { select: { id: true, name: true, username: true } },
  items: { include: { product: true } },
} as const

export const GET = withAuth(async (_request, { user }) => {
  const salesOrders = await prisma.salesOrder.findMany({
    where: ownershipWhere(user),
    include: salesOrderInclude,
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(salesOrders)
})

export const POST = withAuth(async (request, { user }) => {
  const body = await readJson(request)
  const { customerId, warehouseId, expectedDelivery, notes } = body
  if (!customerId || !warehouseId) {
    throw new HttpError(400, "Customer, Warehouse, and at least one item are required")
  }
  const items = parseOrderItems(body.items)
  const status = parseOrderStatus(body.status)

  await assertCanReference(user, {
    customerId,
    warehouseId,
    productIds: items.map((item) => item.productId),
  })

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = subtotal * 0.05 // 5% tax
  const discount = 0
  const total = subtotal + tax - discount

  const orderCount = await prisma.salesOrder.count()
  const orderNumber = `SO-${String(orderCount + 1).padStart(6, "0")}`

  const orderId = await prisma.$transaction(
    async (tx) => {
      const salesOrder = await tx.salesOrder.create({
        data: {
          orderNumber,
          customerId,
          warehouseId,
          userId: user.id,
          expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : null,
          subtotal,
          tax,
          discount,
          total,
          status,
          notes: notes || null,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.quantity * item.unitPrice,
            })),
          },
        },
      })

      // The customer balance is derived from orders and payments
      // (lib/balances.ts), so nothing else needs updating here.

      // Guarded, atomic deduction: fails the whole transaction if any line
      // does not have enough unreserved stock (no read-then-write race).
      for (const item of items) {
        await decrementStock(tx, { productId: item.productId, warehouseId, quantity: item.quantity })
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId,
            type: "OUT",
            quantity: item.quantity,
            reference: orderNumber,
            referenceId: salesOrder.id,
            notes: `Sales order ${orderNumber}`,
            userId: user.id,
          },
        })
      }

      return salesOrder.id
    },
    { maxWait: 10000, timeout: 15000 }
  )

  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    include: salesOrderInclude,
  })
  return NextResponse.json(order, { status: 201 })
})

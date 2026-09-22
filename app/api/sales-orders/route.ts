import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { calculateOrderTotals, parseOrderItems, parseOrderStatus } from "@/lib/orders"
import { decrementStock } from "@/lib/stock"
import { dateRangeWhere, listResponse } from "@/lib/pagination"
import type { Prisma } from "@prisma/client"

const salesOrderInclude = {
  customer: true,
  warehouse: true,
  user: { select: { id: true, name: true, username: true } },
  items: { include: { product: true } },
} as const

// Lighter shape for reports/lists that do not need line items.
const salesOrderSummaryInclude = {
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
} as const

// Supports ?page, ?pageSize, ?from, ?to (orderDate), ?status and ?view=summary.
export const GET = withAuth(async (request, { user }) => {
  const params = new URL(request.url).searchParams
  const status = params.get("status")
  const where: Prisma.SalesOrderWhereInput = {
    ...ownershipWhere(user),
    ...dateRangeWhere(request, "orderDate"),
    ...(status && { status: parseOrderStatus(status) }),
  }
  const include = params.get("view") === "summary" ? salesOrderSummaryInclude : salesOrderInclude
  return listResponse(request, {
    findMany: (page) => prisma.salesOrder.findMany({ where, include, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.salesOrder.count({ where }),
  })
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

  const { subtotal, tax, discount, total } = calculateOrderTotals(items, "0.05") // 5% tax

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
              subtotal: item.subtotal,
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
  return json(order, { status: 201 })
})

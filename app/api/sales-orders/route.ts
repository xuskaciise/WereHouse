import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { salesDiscountLimit, scopeWhere } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import { createWithOrderNumber, parseOrderItems, parseOrderStatus } from "@/lib/orders"
import {
  calculateSalesTotals,
  formatPercent,
  isDiscountReasonRequired,
  parseDiscount,
  parseDiscountReason,
  reasonReferenceLimit,
} from "@/lib/sales-discounts"
import { decrementStock } from "@/lib/stock"
import { averageCost } from "@/lib/stock-valuation"
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
    ...scopeWhere(user, "sales"),
    ...dateRangeWhere(request, "orderDate"),
    ...(status && { status: parseOrderStatus(status) }),
  }
  const include = params.get("view") === "summary" ? salesOrderSummaryInclude : salesOrderInclude
  return listResponse(request, {
    findMany: (page) => prisma.salesOrder.findMany({ where, include, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.salesOrder.count({ where }),
  })
}, { permission: [["sales", "view"], ["reports_sales", "view"], ["reports_finance", "view"]] })

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

  // Discounts: validated and calculated here in Decimal (client totals ignored).
  const rawItems = body.items as { discount?: unknown }[]
  const totals = calculateSalesTotals(
    items,
    rawItems.map((raw, index) => parseDiscount(raw?.discount, `Line ${index + 1}`)),
    parseDiscount(body.discount, "Order"),
    (index) => `Line ${index + 1}`
  )
  // Limits come from the sales_discount permission (Roles & Permissions).
  let discountReason: string | null = null
  if (!totals.totalDiscount.isZero()) {
    const limit = salesDiscountLimit(user) // 403 if the role may not give discounts
    if (limit !== null && totals.discountPercent.gt(limit)) {
      throw new HttpError(
        403,
        `The total discount of ${formatPercent(totals.discountPercent)}% exceeds your limit of ${limit}%. Ask a sales manager or admin to create this order.`
      )
    }
    const reference = await reasonReferenceLimit(limit)
    discountReason = parseDiscountReason(body.discountReason, isDiscountReasonRequired(totals.discountPercent, reference))
  }
  const { subtotal, tax, discount, total } = totals

  const orderId = await createWithOrderNumber(
    "SO",
    () => prisma.salesOrder.count(),
    (orderNumber) =>
      prisma.$transaction(
        async (tx) => {
          // COGS: the warehouse average cost of each product at this moment
          // (rows locked, so a concurrent receipt cannot change it mid-sale).
          const unitCosts = new Map<string, Prisma.Decimal>()
          for (const productId of new Set(totals.lines.map((line) => line.productId))) {
            unitCosts.set(productId, await averageCost(tx, productId, warehouseId))
          }

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
              discountType: totals.discountType,
              discountValue: totals.discountValue,
              itemDiscount: totals.itemDiscount,
              discountReason,
              total,
              status,
              notes: notes || null,
              items: {
                create: totals.lines.map((line) => ({
                  productId: line.productId,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  subtotal: line.subtotal,
                  discountType: line.discountType,
                  discountValue: line.discountValue,
                  discountAmount: line.discountAmount,
                  unitCost: unitCosts.get(line.productId)!,
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
        TX_OPTIONS
      )
  )

  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    include: salesOrderInclude,
  })
  return json(order, { status: 201 })
}, { permission: ["sales", "create"] })

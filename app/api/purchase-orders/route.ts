import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { hasPermission, scopeWhere } from "@/lib/permissions"
import { ZERO } from "@/lib/money"
import { landedTotals } from "@/lib/landed-cost-service"
import { assertCanReference } from "@/lib/ownership"
import { calculateOrderTotals, createWithOrderNumber, parseOrderItems, parseOrderStatus } from "@/lib/orders"
import { containsAny, dateRangeWhere, listResponse, searchTerm } from "@/lib/pagination"
import { purchaseOrderDetailInclude as purchaseOrderInclude } from "@/lib/purchase-orders"
import { currentTaxRate } from "@/lib/tax"

// Lighter shape for reports/lists that do not need line items.
const purchaseOrderSummaryInclude = {
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
} satisfies Prisma.PurchaseOrderInclude

// Supports ?page, ?pageSize, ?from, ?to (orderDate), ?status and ?view=summary.
export const GET = withAuth(async (request, { user }) => {
  const params = new URL(request.url).searchParams
  const status = params.get("status")
  const where: Prisma.PurchaseOrderWhereInput = {
    // ?q= order number or supplier; ?supplierId=
    ...containsAny(searchTerm(request), ["orderNumber", "supplier.name"]),
    ...(params.get("supplierId") && { supplierId: params.get("supplierId")! }),
    ...scopeWhere(user, "purchases"),
    ...dateRangeWhere(request, "orderDate"),
    ...(status && { status: parseOrderStatus(status) }),
  }
  const include = params.get("view") === "summary" ? purchaseOrderSummaryInclude : purchaseOrderInclude
  const seesLandedCosts = hasPermission(user, ["landed_costs", "view"])
  return listResponse(request, {
    findMany: (page) => prisma.purchaseOrder.findMany({ where, include, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.purchaseOrder.count({ where }),
    map: async (orders) => {
      if (!seesLandedCosts || orders.length === 0) return orders
      // `total` stays the goods total owed to the supplier; landed costs are
      // owed to their own parties and only added for the landed total.
      const sums = await prisma.purchaseLandedCost.groupBy({
        by: ["purchaseOrderId"],
        where: { purchaseOrderId: { in: orders.map((o) => o.id) } },
        _sum: { amount: true },
      })
      const byOrder = new Map(sums.map((s) => [s.purchaseOrderId, s._sum.amount ?? ZERO]))
      return orders.map((o) => ({ ...o, ...landedTotals(o.total, byOrder.get(o.id) ?? ZERO) }))
    },
  })
}, { permission: [["purchases", "view"], ["reports_stock", "view"], ["reports_finance", "view"]] })

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

  // Purchase tax rate from Settings, stored on the order.
  const taxRate = await currentTaxRate("purchase")
  const { subtotal, tax, discount, total } = calculateOrderTotals(items, taxRate)

  // Stock is only updated when goods are received (see .../receive), and the
  // supplier balance is derived from orders and payments (lib/balances.ts).
  const purchaseOrder = await createWithOrderNumber(
    "PO",
    () => prisma.purchaseOrder.count(),
    (orderNumber) =>
      prisma.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId,
          warehouseId,
          userId: user.id,
          expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : null,
          subtotal,
          tax,
          taxRate,
          discount,
          total,
          status: "PENDING",
          notes: notes || null,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              originalQuantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
            })),
          },
        },
        include: purchaseOrderInclude,
      })
  )

  return json(purchaseOrder, { status: 201 })
}, { permission: ["purchases", "create"] })

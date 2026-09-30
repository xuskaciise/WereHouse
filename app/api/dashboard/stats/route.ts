import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { hasPermission, isOwnScope, scopeWhere } from "@/lib/permissions"
import { salesProfit } from "@/lib/profit"
import { inTransitStock } from "@/lib/stock-transfers"

const CHART_MONTHS = 6

// All figures are computed in the database with aggregates; no table is
// loaded into memory, so the cost stays flat as data grows.
// Scope from the "dashboard" permission: ALL = company-wide figures, OWN =
// only records the user created (sales officers, students).
export const GET = withAuth(async (_request, { user }) => {
  const where = scopeWhere(user, "dashboard")
  const own = isOwnScope(user, "dashboard")
  const stockOwner = own ? Prisma.sql`AND s."userId" = ${user.id}` : Prisma.empty
  const orderOwner = own ? Prisma.sql`AND "userId" = ${user.id}` : Prisma.empty
  const deliveryOwner = own ? Prisma.sql`AND so."userId" = ${user.id}` : Prisma.empty

  const now = new Date()
  const chartStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (CHART_MONTHS - 1), 1))

  const [
    totalProducts,
    stockSummary,
    salesSum,
    purchaseSum,
    recentMovements,
    recentSales,
    monthlySales,
    monthlyPurchases,
  ] = await Promise.all([
    prisma.product.count({ where }),
    prisma.$queryRaw<{ stockValue: Prisma.Decimal | null; lowStockCount: bigint }[]>`
      SELECT
        SUM(s."quantity" * s."avgCost") AS "stockValue",
        COUNT(*) FILTER (WHERE s."quantity" - s."reservedQuantity" <= p."reorderLevel") AS "lowStockCount"
      FROM "stock" s
      JOIN "products" p ON p."id" = s."productId"
      WHERE TRUE ${stockOwner}`,
    // Sales = deliveries (revenue arises at delivery; drafts, open and
    // cancelled orders are not sales). Discounts: the delivered share of the
    // order discount + of the line discounts.
    prisma.$queryRaw<{ total: Prisma.Decimal | null; returned: Prisma.Decimal | null; discount: Prisma.Decimal | null; itemDiscount: Prisma.Decimal | null }[]>`
      SELECT
        (SELECT SUM(d."total") FROM "sales_deliveries" d JOIN "sales_orders" so ON so."id" = d."salesOrderId" WHERE TRUE ${deliveryOwner}) AS "total",
        (SELECT SUM(r."total") FROM "sales_returns" r JOIN "sales_orders" so ON so."id" = r."salesOrderId" WHERE TRUE ${deliveryOwner}) AS "returned",
        (SELECT SUM(d."discount") FROM "sales_deliveries" d JOIN "sales_orders" so ON so."id" = d."salesOrderId" WHERE TRUE ${deliveryOwner}) AS "discount",
        (SELECT SUM(ROUND(di."quantity" * i."discountAmount" / NULLIF(i."quantity", 0), 2))
           FROM "sales_delivery_items" di
           JOIN "sales_order_items" i ON i."id" = di."salesOrderItemId"
           JOIN "sales_orders" so ON so."id" = i."salesOrderId"
          WHERE TRUE ${deliveryOwner}) AS "itemDiscount"`,
    prisma.purchaseOrder.aggregate({ where, _sum: { total: true } }),
    prisma.stockMovement.findMany({
      where,
      include: {
        product: true,
        warehouse: true,
        user: { select: { id: true, name: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.salesOrder.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.$queryRaw<{ month: string; total: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc('month', x."at"), 'YYYY-MM') AS month, SUM(x."total") AS total
      FROM (
        SELECT d."deliveredAt" AS "at", d."total" FROM "sales_deliveries" d JOIN "sales_orders" so ON so."id" = d."salesOrderId"
        WHERE d."deliveredAt" >= ${chartStart} ${deliveryOwner}
        UNION ALL
        SELECT r."returnDate", -r."total" FROM "sales_returns" r JOIN "sales_orders" so ON so."id" = r."salesOrderId"
        WHERE r."returnDate" >= ${chartStart} ${deliveryOwner}
      ) x
      GROUP BY 1`,
    prisma.$queryRaw<{ month: string; total: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc('month', "orderDate"), 'YYYY-MM') AS month, SUM("total") AS total
      FROM "purchase_orders"
      WHERE "orderDate" >= ${chartStart} ${orderOwner}
      GROUP BY 1`,
  ])

  const salesByMonth = new Map(monthlySales.map((row) => [row.month, Number(row.total)]))
  const purchasesByMonth = new Map(monthlyPurchases.map((row) => [row.month, Number(row.total)]))

  const chartData = Array.from({ length: CHART_MONTHS }, (_, i) => {
    const month = new Date(Date.UTC(chartStart.getUTCFullYear(), chartStart.getUTCMonth() + i, 1))
    const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`
    return {
      month: month.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      sales: salesByMonth.get(key) ?? 0,
      purchases: purchasesByMonth.get(key) ?? 0,
    }
  })

  // Gross profit only for roles that see costs and a sales/finance report.
  const showProfit =
    hasPermission(user, ["product_cost", "view"]) &&
    hasPermission(user, [["reports_sales", "view"], ["reports_finance", "view"]])
  const profit = showProfit ? (await salesProfit({ where, adjustmentWhere: where })).totals : null

  // Goods in transit belong to neither warehouse but are part of the stock value.
  const inTransit = await inTransitStock(own ? { userId: user.id } : {})
  const warehouseValue = Number(stockSummary[0]?.stockValue ?? 0)

  return json({
    inTransitValue: inTransit.inTransitValue,
    warehouseStockValue: warehouseValue,
    ...(profit && { grossProfit: profit.grossProfit, marginPercent: profit.marginPercent, cogs: profit.cogs }),
    totalProducts,
    totalStockValue: inTransit.inTransitValue.plus(warehouseValue),
    // Delivered minus returned (credit notes).
    totalSales: (salesSum[0]?.total ?? new Prisma.Decimal(0)).minus(salesSum[0]?.returned ?? 0),
    // Order-level + item discounts of the delivered goods, same scope as totalSales.
    totalSalesDiscounts: (salesSum[0]?.discount ?? new Prisma.Decimal(0)).plus(salesSum[0]?.itemDiscount ?? 0),
    totalPurchases: purchaseSum._sum.total ?? 0,
    lowStockCount: Number(stockSummary[0]?.lowStockCount ?? 0),
    recentMovements,
    recentSales,
    chartData,
  })
}, { permission: ["dashboard", "view"] })

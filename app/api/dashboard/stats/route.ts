import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { isAdmin, ownershipWhere } from "@/lib/auth-guard"

const CHART_MONTHS = 6

// All figures are computed in the database with aggregates; no table is
// loaded into memory, so the cost stays flat as data grows.
export const GET = withAuth(async (_request, { user }) => {
  const where = ownershipWhere(user)
  const stockOwner = isAdmin(user) ? Prisma.empty : Prisma.sql`AND s."userId" = ${user.id}`
  const orderOwner = isAdmin(user) ? Prisma.empty : Prisma.sql`AND "userId" = ${user.id}`

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
        SUM(s."quantity" * p."costPrice") AS "stockValue",
        COUNT(*) FILTER (WHERE s."quantity" <= p."reorderLevel") AS "lowStockCount"
      FROM "stock" s
      JOIN "products" p ON p."id" = s."productId"
      WHERE TRUE ${stockOwner}`,
    prisma.salesOrder.aggregate({ where, _sum: { total: true } }),
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
      SELECT to_char(date_trunc('month', "orderDate"), 'YYYY-MM') AS month, SUM("total") AS total
      FROM "sales_orders"
      WHERE "orderDate" >= ${chartStart} ${orderOwner}
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

  return json({
    totalProducts,
    totalStockValue: Number(stockSummary[0]?.stockValue ?? 0),
    totalSales: salesSum._sum.total ?? 0,
    totalPurchases: purchaseSum._sum.total ?? 0,
    lowStockCount: Number(stockSummary[0]?.lowStockCount ?? 0),
    recentMovements,
    recentSales,
    chartData,
  })
})

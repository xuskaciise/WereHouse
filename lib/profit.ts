import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { type Money, Decimal, ZERO, sumMoney } from "@/lib/money"

// Gross profit of sales, in Decimal, from the DELIVERIES in the period
// (revenue and COGS arise at delivery, not when an order is confirmed):
//   revenue = delivered amount after all discounts, excluding tax
//             (delivery subtotal - delivery discount)
//   COGS    = delivered quantity x the warehouse average cost at delivery
//             (stored on each delivery line), plus COGS adjustments booked in
//             the period (landed costs added after the goods were sold)
//   gross profit = revenue - COGS; margin % = gross profit / revenue
// Lines sold before cost tracking carry an estimated cost (costEstimated).
// Optionally (finance view): stock losses from transfers in the period
// (TRANSFER_LOSS) and "profit after losses"; gross profit is not changed.

export function marginPercent(revenue: Money, profit: Money): Money {
  return revenue.isZero() ? ZERO : profit.times(100).div(revenue).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

export async function salesProfit(options: {
  where: Prisma.SalesOrderWhereInput
  /** Scope for the COGS adjustments (e.g. { userId } for own-data roles). */
  adjustmentWhere?: Prisma.InventoryValuationEntryWhereInput
  from?: Date | null
  to?: Date | null
  includeLosses?: boolean
}) {
  const dateRange = {
    ...(options.from && { gte: options.from }),
    ...(options.to && { lte: options.to }),
  }
  const deliveries = await prisma.salesDelivery.findMany({
    where: { salesOrder: options.where, ...(Object.keys(dateRange).length && { deliveredAt: dateRange }) },
    select: {
      subtotal: true,
      discount: true,
      cogs: true,
      deliveredAt: true,
      salesOrder: { select: { id: true, orderNumber: true, orderDate: true, items: { select: { costEstimated: true } } } },
    },
    orderBy: { deliveredAt: "desc" },
  })
  // One row per order (all of its deliveries in the period).
  const byOrder = new Map<string, { id: string; orderNumber: string; orderDate: Date; revenue: Money; cogs: Money; estimated: boolean }>()
  for (const d of deliveries) {
    const row = byOrder.get(d.salesOrder.id) ?? {
      id: d.salesOrder.id,
      orderNumber: d.salesOrder.orderNumber,
      orderDate: d.salesOrder.orderDate,
      revenue: ZERO,
      cogs: ZERO,
      estimated: d.salesOrder.items.some((i) => i.costEstimated),
    }
    row.revenue = row.revenue.plus(d.subtotal.minus(d.discount))
    row.cogs = row.cogs.plus(d.cogs)
    byOrder.set(row.id, row)
  }
  const adjustments = await prisma.inventoryValuationEntry.aggregate({
    where: {
      type: "COGS_ADJUSTMENT",
      ...options.adjustmentWhere,
      ...(Object.keys(dateRange).length && { createdAt: dateRange }),
    },
    _sum: { amount: true },
  })

  const losses = options.includeLosses
    ? await prisma.inventoryValuationEntry.aggregate({
        where: {
          type: "TRANSFER_LOSS",
          ...options.adjustmentWhere,
          ...(Object.keys(dateRange).length && { createdAt: dateRange }),
        },
        _sum: { amount: true },
      })
    : null

  const rows = Array.from(byOrder.values()).map((order) => {
    const grossProfit = order.revenue.minus(order.cogs)
    return { ...order, grossProfit, marginPercent: marginPercent(order.revenue, grossProfit) }
  })

  const revenue = sumMoney(rows.map((r) => r.revenue))
  const cogsAdjustments = adjustments._sum.amount ?? ZERO
  const cogs = sumMoney(rows.map((r) => r.cogs)).plus(cogsAdjustments)
  const grossProfit = revenue.minus(cogs)
  return {
    orders: rows,
    totals: {
      revenue,
      cogs,
      cogsAdjustments,
      grossProfit,
      marginPercent: marginPercent(revenue, grossProfit),
      estimatedOrders: rows.filter((r) => r.estimated).length,
      ...(losses && {
        stockLosses: losses._sum.amount ?? ZERO,
        profitAfterLosses: grossProfit.minus(losses._sum.amount ?? ZERO),
      }),
    },
  }
}

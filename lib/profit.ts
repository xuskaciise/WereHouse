import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { type Money, Decimal, ZERO, roundMoney, sumMoney } from "@/lib/money"

// Gross profit of sales, in Decimal:
//   revenue = amount after all discounts, excluding tax (subtotal - discount)
//   COGS    = quantity x unit cost stored on each sales line at the moment of
//             sale (warehouse average cost), plus COGS adjustments booked in
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
  const orders = await prisma.salesOrder.findMany({
    where: { ...options.where, status: { not: "CANCELLED" }, ...(Object.keys(dateRange).length && { orderDate: dateRange }) },
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      subtotal: true,
      discount: true,
      items: { select: { quantity: true, unitCost: true, costEstimated: true } },
    },
    orderBy: { orderDate: "desc" },
  })
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

  const rows = orders.map((order) => {
    const revenue = order.subtotal.minus(order.discount)
    const cogs = sumMoney(order.items.map((i) => roundMoney(i.unitCost.times(i.quantity))))
    const grossProfit = revenue.minus(cogs)
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      revenue,
      cogs,
      grossProfit,
      marginPercent: marginPercent(revenue, grossProfit),
      estimated: order.items.some((i) => i.costEstimated),
    }
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

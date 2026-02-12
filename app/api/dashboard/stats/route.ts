import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    // Get total products count
    const totalProducts = await prisma.product.count()

    // Get total stock value (sum of quantity * costPrice for all stock)
    const stockItems = await prisma.stock.findMany({
      include: {
        product: true,
      },
    })
    const totalStockValue = stockItems.reduce((sum, item) => {
      return sum + (item.quantity * (item.product.costPrice || 0))
    }, 0)

    // Get total sales (sum of all sales orders)
    const salesOrders = await prisma.salesOrder.findMany()
    const totalSales = salesOrders.reduce((sum, order) => sum + order.total, 0)

    // Get total purchases (sum of all purchase orders)
    const purchaseOrders = await prisma.purchaseOrder.findMany()
    const totalPurchases = purchaseOrders.reduce((sum, order) => sum + order.total, 0)

    // Get low stock alert count (products below reorder level)
    const lowStockItems = stockItems.filter(
      (item) => item.quantity <= (item.product.reorderLevel || 0)
    )
    const lowStockCount = lowStockItems.length

    // Get recent stock movements (last 5)
    const recentMovements = await prisma.stockMovement.findMany({
      include: {
        product: true,
        warehouse: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    })

    // Get recent sales orders (last 5)
    const recentSales = await prisma.salesOrder.findMany({
      include: {
        customer: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    })

    // Calculate chart data for last 6 months
    const now = new Date()
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(now.getMonth() - 6)

    const chartData = []
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date()
      monthDate.setMonth(now.getMonth() - i)
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)

      const monthSales = salesOrders
        .filter((order) => {
          const orderDate = new Date(order.orderDate)
          return orderDate >= monthStart && orderDate <= monthEnd
        })
        .reduce((sum, order) => sum + order.total, 0)

      const monthPurchases = purchaseOrders
        .filter((order) => {
          const orderDate = new Date(order.orderDate)
          return orderDate >= monthStart && orderDate <= monthEnd
        })
        .reduce((sum, order) => sum + order.total, 0)

      const monthName = monthDate.toLocaleString("default", { month: "short" })
      chartData.push({
        month: monthName,
        sales: monthSales,
        purchases: monthPurchases,
      })
    }

    return NextResponse.json({
      totalProducts,
      totalStockValue,
      totalSales,
      totalPurchases,
      lowStockCount,
      recentMovements,
      recentSales,
      chartData,
    })
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    return NextResponse.json(
      { error: "Failed to fetch dashboard statistics" },
      { status: 500 }
    )
  }
}

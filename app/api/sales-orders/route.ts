import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const salesOrders = await prisma.salesOrder.findMany({
      include: {
        customer: true,
        warehouse: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(salesOrders)
  } catch (error) {
    console.error("Error fetching sales orders:", error)
    return NextResponse.json(
      { error: "Failed to fetch sales orders" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { customerId, warehouseId, expectedDelivery, items, notes, status } = body

    if (!customerId || !warehouseId || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Customer, Warehouse, and at least one item are required" },
        { status: 400 }
      )
    }

    // Get current user (for now, use a default user - in production, get from session)
    const defaultUser = await prisma.user.findFirst({
      where: { role: "ADMIN" },
    })

    if (!defaultUser) {
      return NextResponse.json(
        { error: "No user found. Please create a user first." },
        { status: 400 }
      )
    }

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: any) => {
      return sum + (item.quantity * item.unitPrice)
    }, 0)
    const tax = subtotal * 0.05 // 5% tax
    const discount = 0
    const total = subtotal + tax - discount

    // Generate order number
    const orderCount = await prisma.salesOrder.count()
    const orderNumber = `SO-${String(orderCount + 1).padStart(6, "0")}`

    // Use transaction to create order and update customer balance
    // Increase timeout to 15 seconds to handle multiple stock updates
    const result = await prisma.$transaction(async (tx) => {
      // Create sales order
      const salesOrder = await tx.salesOrder.create({
        data: {
          orderNumber,
          customerId,
          warehouseId,
          userId: defaultUser.id,
          expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : null,
          subtotal,
          tax,
          discount,
          total,
          status: status || "PENDING",
          notes: notes || null,
          items: {
            create: items.map((item: any) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.quantity * item.unitPrice,
            })),
          },
        },
      })

      // Update customer balance (increase balance when order is created - customer owes more)
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { balance: true },
      })
      
      if (customer) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            balance: (customer.balance || 0) + total,
          },
        })
      }

      // Update stock for each item in the order
      for (const item of items) {
        const { productId, quantity } = item
        const soldQuantity = parseInt(quantity)

        // Find stock entry
        const existingStock = await tx.stock.findUnique({
          where: {
            productId_warehouseId: {
              productId,
              warehouseId,
            },
          },
        })

        if (existingStock) {
          // Check if we have enough stock
          const availableQuantity = existingStock.quantity - existingStock.reservedQuantity
          if (availableQuantity < soldQuantity) {
            throw new Error(
              `Insufficient stock for product. Available: ${availableQuantity}, Requested: ${soldQuantity}`
            )
          }

          // Update stock: decrease quantity directly (items are sold)
          const newQuantity = existingStock.quantity - soldQuantity

          await tx.stock.update({
            where: { id: existingStock.id },
            data: {
              quantity: newQuantity,
              status: newQuantity === 0 
                ? "OUT_OF_STOCK" 
                : newQuantity < 10 
                ? "LOW_STOCK" 
                : "IN_STOCK",
            },
          })

          // Create stock movement record
          await tx.stockMovement.create({
            data: {
              productId,
              warehouseId,
              type: "OUT",
              quantity: soldQuantity,
              reference: orderNumber,
              referenceId: salesOrder.id,
              notes: `Sales order ${orderNumber}`,
              userId: defaultUser.id,
            },
          })
        } else {
          throw new Error(`No stock found for product in warehouse`)
        }
      }

      // Return the created order ID (we'll fetch with relations outside transaction)
      return salesOrder.id
    }, {
      maxWait: 10000, // Maximum time to wait for a transaction slot
      timeout: 15000, // Maximum time the transaction can run
    })

    // Fetch order with relations outside transaction to avoid timeout
    const orderWithRelations = await prisma.salesOrder.findUnique({
      where: { id: result },
      include: {
        customer: true,
        warehouse: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
      },
    })

    return NextResponse.json(orderWithRelations, { status: 201 })

  } catch (error: any) {
    console.error("Error creating sales order:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create sales order" },
      { status: 500 }
    )
  }
}

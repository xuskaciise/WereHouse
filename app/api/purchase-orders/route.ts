import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      include: {
        supplier: true,
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
    return NextResponse.json(purchaseOrders)
  } catch (error) {
    console.error("Error fetching purchase orders:", error)
    return NextResponse.json(
      { error: "Failed to fetch purchase orders" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { supplierId, warehouseId, expectedDelivery, items, notes, status } = body

    if (!supplierId || !warehouseId || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Supplier, Warehouse, and at least one item are required" },
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
    const tax = subtotal * 0.08 // 8% tax
    const discount = 0
    const total = subtotal + tax - discount

    // Generate order number
    const orderCount = await prisma.purchaseOrder.count()
    const orderNumber = `PO-${String(orderCount + 1).padStart(6, "0")}`

    // Use transaction to create order and update supplier balance
    const result = await prisma.$transaction(async (tx) => {
      // Create purchase order
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId,
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

      // Update supplier balance (increase balance when order is created - we owe supplier more)
      // First get current balance
      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { balance: true },
      })
      
      if (supplier) {
        await tx.supplier.update({
          where: { id: supplierId },
          data: {
            balance: (supplier.balance || 0) + total,
          },
        })
      }

      // Update stock for each item in the order
      for (const item of items) {
        const { productId, quantity } = item
        const purchasedQuantity = parseInt(quantity)

        // Find or create stock entry
        const existingStock = await tx.stock.findUnique({
          where: {
            productId_warehouseId: {
              productId,
              warehouseId,
            },
          },
        })

        if (existingStock) {
          // Update existing stock: increase quantity
          const newQuantity = existingStock.quantity + purchasedQuantity

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
              type: "IN",
              quantity: purchasedQuantity,
              reference: orderNumber,
              referenceId: purchaseOrder.id,
              notes: `Purchase order ${orderNumber}`,
              userId: defaultUser.id,
            },
          })
        } else {
          // Create new stock entry
          await tx.stock.create({
            data: {
              productId,
              warehouseId,
              quantity: purchasedQuantity,
              reservedQuantity: 0,
              status: purchasedQuantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
            },
          })

          // Create stock movement record
          await tx.stockMovement.create({
            data: {
              productId,
              warehouseId,
              type: "IN",
              quantity: purchasedQuantity,
              reference: orderNumber,
              referenceId: purchaseOrder.id,
              notes: `Purchase order ${orderNumber}`,
              userId: defaultUser.id,
            },
          })
        }
      }

      // Fetch order with relations
      return await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrder.id },
        include: {
          supplier: true,
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
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error("Error creating purchase order:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create purchase order" },
      { status: 500 }
    )
  }
}

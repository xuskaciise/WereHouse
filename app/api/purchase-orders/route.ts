import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    // Try to fetch with supplier balance first
    let purchaseOrders
    try {
      purchaseOrders = await prisma.purchaseOrder.findMany({
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
    } catch (dbError: any) {
      // If balance column doesn't exist, fetch without it
      if (dbError.message?.includes("balance") || dbError.message?.includes("does not exist")) {
        purchaseOrders = await prisma.purchaseOrder.findMany({
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                address: true,
                city: true,
                state: true,
                zipCode: true,
                country: true,
                contactPerson: true,
                createdAt: true,
                updatedAt: true,
              },
            },
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
      } else {
        throw dbError
      }
    }
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

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: any) => {
      return sum + (item.quantity * item.unitPrice)
    }, 0)
    const tax = subtotal * 0.08 // 8% tax
    const discount = 0
    const total = subtotal + tax - discount

    // Generate order number (do this outside transaction to avoid long transaction)
    const orderCount = await prisma.purchaseOrder.count()
    const orderNumber = `PO-${String(orderCount + 1).padStart(6, "0")}`

    // Use transaction to create order and update supplier balance
    // Increased timeout to 30 seconds for complex operations
    const result = await prisma.$transaction(async (tx) => {
      // Get current user inside transaction (for now, use a default user - in production, get from session)
      const defaultUser = await tx.user.findFirst({
        where: { role: "ADMIN" },
      })

      if (!defaultUser) {
        throw new Error("No user found. Please create a user first.")
      }
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
      // Use savepoint to prevent balance update failure from aborting the transaction
      try {
        // Create a savepoint
        await tx.$executeRaw`SAVEPOINT balance_update`
        
        // Check if balance column exists and update
        const columnExists = await tx.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'suppliers' 
            AND column_name = 'balance'
          ) as exists
        `
        
        if (columnExists[0]?.exists) {
          await tx.$executeRaw`
            UPDATE suppliers 
            SET balance = COALESCE(balance, 0) + ${total}
            WHERE id = ${supplierId}
          `
        }
        
        // Release savepoint if successful
        await tx.$executeRaw`RELEASE SAVEPOINT balance_update`
      } catch (balanceError: any) {
        // Rollback to savepoint if balance update fails
        try {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT balance_update`
        } catch (rollbackError) {
          // Ignore rollback errors
        }
        // Balance will be calculated on-the-fly from purchase orders and payments
        console.log("Skipping balance update:", balanceError.message)
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

      return purchaseOrder
    }, {
      maxWait: 10000, // Maximum time to wait for a transaction slot
      timeout: 30000, // Maximum time the transaction can run (30 seconds)
    })

    // Fetch order with relations outside transaction to avoid timeout
    // Handle missing balance column gracefully
    let orderWithRelations
    try {
      orderWithRelations = await prisma.purchaseOrder.findUnique({
        where: { id: result.id },
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
    } catch (dbError: any) {
      // If balance column doesn't exist, fetch without it
      if (dbError.message?.includes("balance") || dbError.message?.includes("does not exist")) {
        orderWithRelations = await prisma.purchaseOrder.findUnique({
          where: { id: result.id },
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                address: true,
                city: true,
                state: true,
                zipCode: true,
                country: true,
                contactPerson: true,
                createdAt: true,
                updatedAt: true,
              },
            },
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
      } else {
        throw dbError
      }
    }

    return NextResponse.json(orderWithRelations, { status: 201 })
  } catch (error: any) {
    console.error("Error creating purchase order:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create purchase order" },
      { status: 500 }
    )
  }
}

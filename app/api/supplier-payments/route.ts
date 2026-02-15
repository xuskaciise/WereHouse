import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    // Try to fetch with supplier balance first
    let payments
    try {
      payments = await prisma.supplierPayment.findMany({
        include: {
          supplier: true,
          purchaseOrder: true,
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
      })
    } catch (dbError: any) {
      // If balance column doesn't exist, fetch without it
      if (dbError.message?.includes("balance") || dbError.message?.includes("does not exist")) {
        payments = await prisma.supplierPayment.findMany({
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
            purchaseOrder: true,
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
        })
      } else {
        throw dbError
      }
    }
    return NextResponse.json(payments)
  } catch (error) {
    console.error("Error fetching supplier payments:", error)
    return NextResponse.json(
      { error: "Failed to fetch supplier payments" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { supplierId, purchaseOrderId, amount, paymentDate, paymentMethod, reference, notes } = body

    if (!supplierId || !amount || !paymentMethod) {
      return NextResponse.json(
        { error: "Supplier, Amount, and Payment Method are required" },
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

    // Use transaction to update supplier balance and create payment
    const result = await prisma.$transaction(async (tx) => {
      // Create payment
      const payment = await tx.supplierPayment.create({
        data: {
          supplierId,
          purchaseOrderId: purchaseOrderId || null,
          amount: parseFloat(amount),
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          paymentMethod,
          reference: reference || null,
          notes: notes || null,
          userId: defaultUser.id,
        },
      })

      // Update supplier balance (decrease balance when we pay supplier - reduces what we owe)
      // Handle case where balance column might not exist
      try {
        // First get current balance
        const supplier = await tx.supplier.findUnique({
          where: { id: supplierId },
          select: { balance: true },
        })
        
        if (supplier) {
          await tx.supplier.update({
            where: { id: supplierId },
            data: {
              balance: (supplier.balance || 0) - parseFloat(amount),
            },
          })
        }
      } catch (balanceError: any) {
        // If balance column doesn't exist, skip balance update
        // Balance will be calculated on-the-fly from purchase orders and payments
        if (!balanceError.message?.includes("balance") && !balanceError.message?.includes("does not exist")) {
          // Only log if it's a different error
          console.error("Error updating supplier balance:", balanceError)
        }
        // Continue with payment creation even if balance update fails
      }

      // Fetch updated supplier with payment
      // Handle missing balance column gracefully
      try {
        return await tx.supplierPayment.findUnique({
          where: { id: payment.id },
          include: {
            supplier: true,
            purchaseOrder: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        })
      } catch (dbError: any) {
        // If balance column doesn't exist, fetch without it
        if (dbError.message?.includes("balance") || dbError.message?.includes("does not exist")) {
          return await tx.supplierPayment.findUnique({
            where: { id: payment.id },
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
              purchaseOrder: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
            },
          })
        } else {
          throw dbError
        }
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error("Error creating supplier payment:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create supplier payment" },
      { status: 500 }
    )
  }
}

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser, ownershipWhere } from "@/lib/rbac"

export async function GET(request: Request) {
  try {
    const currentUser = await getRequestUser(request)
    const payments = await prisma.customerPayment.findMany({
      where: ownershipWhere(currentUser),
      include: {
        customer: true,
        salesOrder: true,
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
    return NextResponse.json(payments)
  } catch (error) {
    console.error("Error fetching customer payments:", error)
    return NextResponse.json(
      { error: "Failed to fetch customer payments" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const body = await request.json()
    const { customerId, salesOrderId, amount, paymentDate, paymentMethod, reference, notes } = body

    if (!customerId || !amount || !paymentMethod) {
      return NextResponse.json(
        { error: "Customer, Amount, and Payment Method are required" },
        { status: 400 }
      )
    }

    // Use transaction to update customer balance and create payment
    const result = await prisma.$transaction(async (tx) => {
      // Create payment
      const payment = await tx.customerPayment.create({
        data: {
          customerId,
          salesOrderId: salesOrderId || null,
          amount: parseFloat(amount),
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          paymentMethod,
          reference: reference || null,
          notes: notes || null,
          userId: currentUser.id,
        },
      })

      // Update customer balance (decrease balance when customer pays)
      await tx.customer.update({
        where: { id: customerId },
        data: {
          balance: {
            decrement: parseFloat(amount),
          },
        },
      })

      // Fetch updated customer with payment
      return await tx.customerPayment.findUnique({
        where: { id: payment.id },
      include: {
        customer: true,
        salesOrder: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      })
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error("Error creating customer payment:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create customer payment" },
      { status: 500 }
    )
  }
}

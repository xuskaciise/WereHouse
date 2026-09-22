import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { isAdmin } from "@/lib/auth-guard"

export const GET = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
    const payment = await prisma.customerPayment.findUnique({
      where: { id },
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

    if (!payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }
    if (!isAdmin(currentUser) && payment.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(payment)
  } catch (error) {
    console.error("Error fetching customer payment:", error)
    return NextResponse.json(
      { error: "Failed to fetch customer payment" },
      { status: 500 }
    )
  }
})

export const PUT = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
    const body = await request.json()
    const { amount, paymentDate, paymentMethod, reference, notes } = body

    if (!amount || !paymentMethod) {
      return NextResponse.json(
        { error: "Amount and Payment Method are required" },
        { status: 400 }
      )
    }

    // Get current payment to calculate balance difference
    const currentPayment = await prisma.customerPayment.findUnique({
      where: { id },
      include: { customer: true },
    })

    if (!currentPayment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }
    if (!isAdmin(currentUser) && currentPayment.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const amountDifference = parseFloat(amount) - currentPayment.amount

    // Use transaction to update payment and adjust customer balance
    const result = await prisma.$transaction(async (tx) => {
      // Update payment
      const payment = await tx.customerPayment.update({
        where: { id },
        data: {
          amount: parseFloat(amount),
          paymentDate: paymentDate ? new Date(paymentDate) : currentPayment.paymentDate,
          paymentMethod,
          reference: reference || null,
          notes: notes || null,
        },
      })

      // Adjust customer balance based on amount difference
      if (amountDifference !== 0) {
        await tx.customer.update({
          where: { id: currentPayment.customerId },
          data: {
            balance: {
              decrement: amountDifference, // If new amount is higher, balance decreases more
            },
          },
        })
      }

      // Fetch updated payment with relations
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

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("Error updating customer payment:", error)
    return NextResponse.json(
      { error: error.message || "Failed to update customer payment" },
      { status: 500 }
    )
  }
})

export const DELETE = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params

    // Get current payment to restore customer balance
    const currentPayment = await prisma.customerPayment.findUnique({
      where: { id },
      include: { customer: true },
    })

    if (!currentPayment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }
    if (!isAdmin(currentUser) && currentPayment.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Use transaction to delete payment and restore customer balance
    await prisma.$transaction(async (tx) => {
      // Restore customer balance (increase balance when payment is deleted)
      await tx.customer.update({
        where: { id: currentPayment.customerId },
        data: {
          balance: {
            increment: currentPayment.amount,
          },
        },
      })

      // Delete payment
      await tx.customerPayment.delete({
        where: { id },
      })
    })

    return NextResponse.json({ message: "Payment deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting customer payment:", error)
    return NextResponse.json(
      { error: error.message || "Failed to delete customer payment" },
      { status: 500 }
    )
  }
})

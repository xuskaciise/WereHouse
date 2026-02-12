import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const payment = await prisma.supplierPayment.findUnique({
      where: { id },
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

    if (!payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    return NextResponse.json(payment)
  } catch (error) {
    console.error("Error fetching supplier payment:", error)
    return NextResponse.json(
      { error: "Failed to fetch supplier payment" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { amount, paymentDate, paymentMethod, reference, notes } = body

    if (!amount || !paymentMethod) {
      return NextResponse.json(
        { error: "Amount and Payment Method are required" },
        { status: 400 }
      )
    }

    // Get current payment to calculate balance difference
    const currentPayment = await prisma.supplierPayment.findUnique({
      where: { id },
      include: { supplier: true },
    })

    if (!currentPayment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    const amountDifference = parseFloat(amount) - currentPayment.amount

    // Use transaction to update payment and adjust supplier balance
    const result = await prisma.$transaction(async (tx) => {
      // Update payment
      const payment = await tx.supplierPayment.update({
        where: { id },
        data: {
          amount: parseFloat(amount),
          paymentDate: paymentDate ? new Date(paymentDate) : currentPayment.paymentDate,
          paymentMethod,
          reference: reference || null,
          notes: notes || null,
        },
      })

      // Adjust supplier balance based on amount difference
      if (amountDifference !== 0) {
        const supplier = await tx.supplier.findUnique({
          where: { id: currentPayment.supplierId },
          select: { balance: true },
        })
        
        if (supplier) {
          await tx.supplier.update({
            where: { id: currentPayment.supplierId },
            data: {
              balance: (supplier.balance || 0) - amountDifference,
            },
          })
        }
      }

      // Fetch updated payment with relations
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
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("Error updating supplier payment:", error)
    return NextResponse.json(
      { error: error.message || "Failed to update supplier payment" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get current payment to restore supplier balance
    const currentPayment = await prisma.supplierPayment.findUnique({
      where: { id },
      include: { supplier: true },
    })

    if (!currentPayment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    // Use transaction to delete payment and restore supplier balance
    await prisma.$transaction(async (tx) => {
      // Restore supplier balance (increase balance when payment is deleted)
      const supplier = await tx.supplier.findUnique({
        where: { id: currentPayment.supplierId },
        select: { balance: true },
      })
      
      if (supplier) {
        await tx.supplier.update({
          where: { id: currentPayment.supplierId },
          data: {
            balance: (supplier.balance || 0) + currentPayment.amount,
          },
        })
      }

      // Delete payment
      await tx.supplierPayment.delete({
        where: { id },
      })
    })

    return NextResponse.json({ message: "Payment deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting supplier payment:", error)
    return NextResponse.json(
      { error: error.message || "Failed to delete supplier payment" },
      { status: 500 }
    )
  }
}

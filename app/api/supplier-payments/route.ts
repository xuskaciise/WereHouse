import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { supplierPaymentInclude as paymentInclude } from "@/lib/includes"

export const GET = withAuth(async (_request, { user }) => {
  const payments = await prisma.supplierPayment.findMany({
    where: ownershipWhere(user),
    include: paymentInclude,
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(payments)
})

export const POST = withAuth(async (request, { user }) => {
  const { supplierId, purchaseOrderId, amount, paymentDate, paymentMethod, reference, notes } =
    await readJson(request)

  const parsedAmount = parseFloat(amount)
  if (!supplierId || !paymentMethod || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new HttpError(400, "Supplier, a positive Amount, and Payment Method are required")
  }

  await assertCanReference(user, { supplierId })
  if (purchaseOrderId) {
    const order = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, supplierId, ...ownershipWhere(user) },
      select: { id: true },
    })
    if (!order) throw new HttpError(400, "Purchase order not found for this supplier")
  }

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.supplierPayment.create({
      data: {
        supplierId,
        purchaseOrderId: purchaseOrderId || null,
        amount: parsedAmount,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        paymentMethod,
        reference: reference || null,
        notes: notes || null,
        userId: user.id,
      },
      include: paymentInclude,
    })

    // Paying a supplier reduces what we owe them.
    await tx.supplier.update({
      where: { id: supplierId },
      data: { balance: { decrement: parsedAmount } },
    })

    return created
  })

  return NextResponse.json(payment, { status: 201 })
})

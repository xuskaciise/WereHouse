import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { withNestedCustomerBalance } from "@/lib/balances"
import { customerPaymentInclude as paymentInclude } from "@/lib/includes"

export const GET = withAuth(async (_request, { user }) => {
  const payments = await prisma.customerPayment.findMany({
    where: ownershipWhere(user),
    include: paymentInclude,
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(await withNestedCustomerBalance(payments))
})

export const POST = withAuth(async (request, { user }) => {
  const { customerId, salesOrderId, amount, paymentDate, paymentMethod, reference, notes } =
    await readJson(request)

  const parsedAmount = parseFloat(amount)
  if (!customerId || !paymentMethod || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new HttpError(400, "Customer, a positive Amount, and Payment Method are required")
  }

  await assertCanReference(user, { customerId })
  if (salesOrderId) {
    const order = await prisma.salesOrder.findFirst({
      where: { id: salesOrderId, customerId, ...ownershipWhere(user) },
      select: { id: true },
    })
    if (!order) throw new HttpError(400, "Sales order not found for this customer")
  }

  // The customer balance is derived from orders and payments (lib/balances.ts).
  const payment = await prisma.customerPayment.create({
    data: {
      customerId,
      salesOrderId: salesOrderId || null,
      amount: parsedAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod,
      reference: reference || null,
      notes: notes || null,
      userId: user.id,
    },
    include: paymentInclude,
  })

  const [withBalance] = await withNestedCustomerBalance([payment])
  return NextResponse.json(withBalance, { status: 201 })
})

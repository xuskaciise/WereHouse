import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, assertOwnership } from "@/lib/auth-guard"
import { parseMoney } from "@/lib/money"
import { withNestedCustomerBalance } from "@/lib/balances"
import { customerPaymentInclude as paymentInclude } from "@/lib/includes"

const NOT_FOUND = "Payment not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const payment = await prisma.customerPayment.findUnique({
    where: { id: params.id },
    include: paymentInclude,
  })
  assertOwnership(user, payment, NOT_FOUND)
  const [withBalance] = await withNestedCustomerBalance([payment])
  return json(withBalance)
})

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const current = await prisma.customerPayment.findUnique({ where: { id: params.id } })
  assertOwnership(user, current, NOT_FOUND)

  const { amount, paymentDate, paymentMethod, reference, notes } = await readJson(request)
  if (!paymentMethod) throw new HttpError(400, "Amount and Payment Method are required")
  const parsedAmount = parseMoney(amount)

  const payment = await prisma.customerPayment.update({
    where: { id: params.id },
    data: {
      amount: parsedAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : current.paymentDate,
      paymentMethod,
      reference: reference || null,
      notes: notes || null,
    },
    include: paymentInclude,
  })

  const [withBalance] = await withNestedCustomerBalance([payment])
  return json(withBalance)
})

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const current = await prisma.customerPayment.findUnique({ where: { id: params.id } })
  assertOwnership(user, current, NOT_FOUND)

  await prisma.customerPayment.delete({ where: { id: params.id } })
  return json({ message: "Payment deleted successfully" })
})

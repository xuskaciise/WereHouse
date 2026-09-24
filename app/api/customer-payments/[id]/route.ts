import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { parsePaymentFields } from "@/lib/payment-fields"
import { HttpError } from "@/lib/auth-guard"
import { assertInScope } from "@/lib/permissions"
import { parseMoney } from "@/lib/money"
import { withNestedCustomerBalance } from "@/lib/balances"
import { customerPaymentInclude as paymentInclude } from "@/lib/includes"

const NOT_FOUND = "Payment not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const payment = await prisma.customerPayment.findUnique({
    where: { id: params.id },
    include: paymentInclude,
  })
  assertInScope(user, "customer_payments", payment, NOT_FOUND)
  const [withBalance] = await withNestedCustomerBalance([payment])
  return json(withBalance)
}, { permission: ["customer_payments", "view"] })

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const current = await prisma.customerPayment.findUnique({ where: { id: params.id } })
  assertInScope(user, "customer_payments", current, NOT_FOUND)

  const body = await readJson(request)
  const { amount, paymentDate, reference, notes } = body
  // A payment may keep a method that was disabled after it was recorded.
  const method = await parsePaymentFields(body, { existingMethod: current.paymentMethod })
  const parsedAmount = parseMoney(amount)

  const payment = await prisma.customerPayment.update({
    where: { id: params.id },
    data: {
      amount: parsedAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : current.paymentDate,
      paymentMethod: method.paymentMethod,
      payerPhone: method.payerPhone,
      transactionId: method.transactionId,
      reference: reference || null,
      notes: notes || null,
    },
    include: paymentInclude,
  })

  const [withBalance] = await withNestedCustomerBalance([payment])
  return json({ ...withBalance, warnings: method.warnings })
}, { permission: ["customer_payments", "edit"] })

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const current = await prisma.customerPayment.findUnique({ where: { id: params.id } })
  assertInScope(user, "customer_payments", current, NOT_FOUND)

  await prisma.customerPayment.delete({ where: { id: params.id } })
  return json({ message: "Payment deleted successfully" })
}, { permission: ["customer_payments", "delete"] })

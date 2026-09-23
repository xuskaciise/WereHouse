import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertInScope } from "@/lib/permissions"
import { parseMoney } from "@/lib/money"
import { withNestedSupplierBalance } from "@/lib/balances"
import { supplierPaymentInclude as paymentInclude } from "@/lib/includes"

const NOT_FOUND = "Payment not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const payment = await prisma.supplierPayment.findUnique({
    where: { id: params.id },
    include: paymentInclude,
  })
  assertInScope(user, "supplier_payments", payment, NOT_FOUND)
  const [withBalance] = await withNestedSupplierBalance([payment])
  return json(withBalance)
}, { permission: ["supplier_payments", "view"] })

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const current = await prisma.supplierPayment.findUnique({ where: { id: params.id } })
  assertInScope(user, "supplier_payments", current, NOT_FOUND)

  const { amount, paymentDate, paymentMethod, reference, notes } = await readJson(request)
  if (!paymentMethod) throw new HttpError(400, "Amount and Payment Method are required")
  const parsedAmount = parseMoney(amount)

  const payment = await prisma.supplierPayment.update({
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

  const [withBalance] = await withNestedSupplierBalance([payment])
  return json(withBalance)
}, { permission: ["supplier_payments", "edit"] })

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const current = await prisma.supplierPayment.findUnique({ where: { id: params.id } })
  assertInScope(user, "supplier_payments", current, NOT_FOUND)

  await prisma.supplierPayment.delete({ where: { id: params.id } })
  return json({ message: "Payment deleted successfully" })
}, { permission: ["supplier_payments", "delete"] })

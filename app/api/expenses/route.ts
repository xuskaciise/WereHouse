import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { parsePaymentFields } from "@/lib/payment-fields"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { parseMoney } from "@/lib/money"
import { dateRangeWhere, listResponse } from "@/lib/pagination"

const expenseInclude = {
  category: true,
  user: { select: { id: true, name: true, username: true } },
} as const

export const GET = withAuth(async (request, { user }) => {
  const where = { ...scopeWhere(user, "expenses"), ...dateRangeWhere(request, "expenseDate"),
    // ?paymentMethod=EVC_PLUS
    ...(new URL(request.url).searchParams.get("paymentMethod") && {
      paymentMethod: new URL(request.url).searchParams.get("paymentMethod")!,
    }) }
  return listResponse(request, {
    findMany: (page) =>
      prisma.expense.findMany({ where, include: expenseInclude, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.expense.count({ where }),
  })
}, { permission: ["expenses", "view"] })

export const POST = withAuth(async (request, { user }) => {
  const body = await readJson(request)
  const { categoryId, amount, description, expenseDate, reference } = body

  if (!categoryId || !description) {
    throw new HttpError(400, "Category, Amount, Description, and Payment Method are required")
  }
  const parsedAmount = parseMoney(amount)
  const method = await parsePaymentFields(body)

  // Categories are shared reference data; only active ones can be used.
  const category = await prisma.expenseCategory.findUnique({ where: { id: String(categoryId) }, select: { isActive: true } })
  if (!category) throw new HttpError(400, "Expense category not found")
  if (!category.isActive) throw new HttpError(400, "This expense category is inactive; choose another one")

  const expense = await prisma.expense.create({
    data: {
      categoryId,
      amount: parsedAmount,
      description,
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      paymentMethod: method.paymentMethod,
      payerPhone: method.payerPhone,
      transactionId: method.transactionId,
      reference: reference || null,
      userId: user.id,
    },
    include: expenseInclude,
  })
  return json({ ...expense, warnings: method.warnings }, { status: 201 })
}, { permission: ["expenses", "create"] })

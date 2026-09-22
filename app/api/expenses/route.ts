import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { parseMoney } from "@/lib/money"
import { dateRangeWhere, listResponse } from "@/lib/pagination"

const expenseInclude = {
  category: true,
  user: { select: { id: true, name: true, username: true } },
} as const

export const GET = withAuth(async (request, { user }) => {
  const where = { ...ownershipWhere(user), ...dateRangeWhere(request, "expenseDate") }
  return listResponse(request, {
    findMany: (page) =>
      prisma.expense.findMany({ where, include: expenseInclude, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.expense.count({ where }),
  })
})

export const POST = withAuth(async (request, { user }) => {
  const { categoryId, amount, description, expenseDate, paymentMethod, reference } = await readJson(request)

  if (!categoryId || !description || !paymentMethod) {
    throw new HttpError(400, "Category, Amount, Description, and Payment Method are required")
  }
  const parsedAmount = parseMoney(amount)

  await assertCanReference(user, { expenseCategoryId: categoryId })

  const expense = await prisma.expense.create({
    data: {
      categoryId,
      amount: parsedAmount,
      description,
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      paymentMethod,
      reference: reference || null,
      userId: user.id,
    },
    include: expenseInclude,
  })
  return json(expense, { status: 201 })
})

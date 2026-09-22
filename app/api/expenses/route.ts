import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"

const expenseInclude = {
  category: true,
  user: { select: { id: true, name: true, username: true } },
} as const

export const GET = withAuth(async (_request, { user }) => {
  const expenses = await prisma.expense.findMany({
    where: ownershipWhere(user),
    include: expenseInclude,
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(expenses)
})

export const POST = withAuth(async (request, { user }) => {
  const { categoryId, amount, description, expenseDate, paymentMethod, reference } = await readJson(request)

  const parsedAmount = parseFloat(amount)
  if (!categoryId || !description || !paymentMethod || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new HttpError(400, "Category, a positive Amount, Description, and Payment Method are required")
  }

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
  return NextResponse.json(expense, { status: 201 })
})

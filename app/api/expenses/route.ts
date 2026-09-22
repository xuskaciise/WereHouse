import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { assertCanReference } from "@/lib/ownership"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"

export const GET = withAuth(async (request, { user: currentUser }) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: ownershipWhere(currentUser),
      include: {
        category: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(expenses)
  } catch (error) {
    if (error instanceof HttpError) throw error
    console.error("Error fetching expenses:", error)
    return NextResponse.json(
      { error: "Failed to fetch expenses" },
      { status: 500 }
    )
  }
})

export const POST = withAuth(async (request, { user: currentUser }) => {
  try {
    const body = await request.json()
    const { categoryId, amount, description, expenseDate, paymentMethod, reference } = body

    if (!categoryId || !amount || !description || !paymentMethod) {
      return NextResponse.json(
        { error: "Category, Amount, Description, and Payment Method are required" },
        { status: 400 }
      )
    }

    await assertCanReference(currentUser, { expenseCategoryId: categoryId })

    const expense = await prisma.expense.create({
      data: {
        categoryId,
        amount: parseFloat(amount),
        description,
        expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
        paymentMethod,
        reference: reference || null,
        userId: currentUser.id,
      },
      include: {
        category: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    })

    return NextResponse.json(expense, { status: 201 })
  } catch (error: any) {
    if (error instanceof HttpError) throw error
    console.error("Error creating expense:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create expense" },
      { status: 500 }
    )
  }
})

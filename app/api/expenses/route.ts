import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const expenses = await prisma.expense.findMany({
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
    console.error("Error fetching expenses:", error)
    return NextResponse.json(
      { error: "Failed to fetch expenses" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { categoryId, amount, description, expenseDate, paymentMethod, reference } = body

    if (!categoryId || !amount || !description || !paymentMethod) {
      return NextResponse.json(
        { error: "Category, Amount, Description, and Payment Method are required" },
        { status: 400 }
      )
    }

    // Get current user (for now, use a default user - in production, get from session)
    const defaultUser = await prisma.user.findFirst({
      where: { role: "ADMIN" },
    })

    if (!defaultUser) {
      return NextResponse.json(
        { error: "No user found. Please create a user first." },
        { status: 400 }
      )
    }

    const expense = await prisma.expense.create({
      data: {
        categoryId,
        amount: parseFloat(amount),
        description,
        expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
        paymentMethod,
        reference: reference || null,
        userId: defaultUser.id,
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
    console.error("Error creating expense:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create expense" },
      { status: 500 }
    )
  }
}

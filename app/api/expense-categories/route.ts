import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const categories = await prisma.expenseCategory.findMany({
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(categories)
  } catch (error) {
    console.error("Error fetching expense categories:", error)
    return NextResponse.json(
      { error: "Failed to fetch expense categories" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, description } = body

    if (!name) {
      return NextResponse.json(
        { error: "Category name is required" },
        { status: 400 }
      )
    }

    const category = await prisma.expenseCategory.create({
      data: {
        name,
        description: description || null,
      },
    })

    return NextResponse.json(category, { status: 201 })
  } catch (error: any) {
    console.error("Error creating expense category:", error)
    
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Category with this name already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to create expense category" },
      { status: 500 }
    )
  }
}

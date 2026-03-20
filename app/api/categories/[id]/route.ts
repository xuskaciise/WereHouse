import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser, isAdminRole } from "@/lib/rbac"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const category = await prisma.category.findUnique({
      where: { id },
    })

    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      )
    }
    if (!isAdminRole(currentUser.role) && category.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(category)
  } catch (error) {
    console.error("Error fetching category:", error)
    return NextResponse.json(
      { error: "Failed to fetch category" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const body = await request.json()
    const { name, description } = body

    if (!name) {
      return NextResponse.json(
        { error: "Category name is required" },
        { status: 400 }
      )
    }

    const existingCategory = await prisma.category.findUnique({ where: { id } })
    if (!existingCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }
    if (!isAdminRole(currentUser.role) && existingCategory.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const category = await prisma.category.update({
      where: { id },
      data: {
        name,
        description: description || null,
      },
    })

    return NextResponse.json(category)
  } catch (error: any) {
    console.error("Error updating category:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      )
    }

    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Category with this name already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Failed to update category" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const existingCategory = await prisma.category.findUnique({ where: { id } })
    if (!existingCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }
    if (!isAdminRole(currentUser.role) && existingCategory.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    await prisma.category.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Category deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting category:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      )
    }

    // Handle foreign key constraint (category has products)
    if (error.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete category that has products. Please remove all products first." },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Failed to delete category" },
      { status: 500 }
    )
  }
}

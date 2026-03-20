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
    const stock = await prisma.stock.findUnique({
      where: { id },
      include: {
        product: true,
        warehouse: true,
      },
    })

    if (!stock) {
      return NextResponse.json(
        { error: "Stock not found" },
        { status: 404 }
      )
    }
    if (!isAdminRole(currentUser.role) && stock.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(stock)
  } catch (error) {
    console.error("Error fetching stock:", error)
    return NextResponse.json(
      { error: "Failed to fetch stock" },
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
    const { quantity, reservedQuantity } = body

    if (quantity === undefined) {
      return NextResponse.json(
        { error: "Quantity is required" },
        { status: 400 }
      )
    }

    // Get existing stock to calculate movement
    const existingStock = await prisma.stock.findUnique({
      where: { id },
    })

    if (!existingStock) {
      return NextResponse.json(
        { error: "Stock not found" },
        { status: 404 }
      )
    }
    if (!isAdminRole(currentUser.role) && existingStock.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const oldQuantity = existingStock.quantity
    const newQuantity = parseInt(quantity)

    const stock = await prisma.stock.update({
      where: { id },
      data: {
        quantity: newQuantity,
        reservedQuantity: reservedQuantity !== undefined ? parseInt(reservedQuantity) : undefined,
        status: newQuantity === 0 
          ? "OUT_OF_STOCK" 
          : newQuantity < 10 
          ? "LOW_STOCK" 
          : "IN_STOCK",
      },
      include: {
        product: true,
        warehouse: true,
      },
    })

    // Get current user for movement record
    if (newQuantity !== oldQuantity) {
      // Create stock movement record
      await prisma.stockMovement.create({
        data: {
          productId: stock.productId,
          warehouseId: stock.warehouseId,
          type: "ADJUSTMENT",
          quantity: newQuantity - oldQuantity,
          reference: "Manual Update",
          notes: "Stock updated via edit",
          userId: currentUser.id,
        },
      })
    }

    return NextResponse.json(stock)
  } catch (error: any) {
    console.error("Error updating stock:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Stock not found" },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: "Failed to update stock" },
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
    const existingStock = await prisma.stock.findUnique({ where: { id } })
    if (!existingStock) {
      return NextResponse.json({ error: "Stock not found" }, { status: 404 })
    }
    if (!isAdminRole(currentUser.role) && existingStock.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    await prisma.stock.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Stock deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting stock:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Stock not found" },
        { status: 404 }
      )
    }

    // Handle foreign key constraint
    if (error.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete stock that has movements. Please remove all related data first." },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Failed to delete stock" },
      { status: 500 }
    )
  }
}

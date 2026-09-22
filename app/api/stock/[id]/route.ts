import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { isAdmin } from "@/lib/auth-guard"

export const GET = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
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
    if (!isAdmin(currentUser) && stock.userId !== currentUser.id) {
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
})

export const PUT = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
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
    if (!isAdmin(currentUser) && existingStock.userId !== currentUser.id) {
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
})

export const DELETE = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
    const existingStock = await prisma.stock.findUnique({ where: { id } })
    if (!existingStock) {
      return NextResponse.json({ error: "Stock not found" }, { status: 404 })
    }
    if (!isAdmin(currentUser) && existingStock.userId !== currentUser.id) {
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
})

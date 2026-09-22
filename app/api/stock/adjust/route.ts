import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"

export const POST = withAuth(async (request, { user: currentUser }) => {
  try {
    const body = await request.json()
    const { productId, warehouseId, adjustmentType, quantity, notes } = body

    if (!productId || !warehouseId || adjustmentType === undefined || quantity === undefined) {
      return NextResponse.json(
        { error: "Product, Warehouse, Adjustment Type, and Quantity are required" },
        { status: 400 }
      )
    }

    await assertCanReference(currentUser, { warehouseId, productIds: [productId] })

    // Get existing stock record
    const existingStock = await prisma.stock.findUnique({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
    })

    const oldQuantity = existingStock?.quantity || 0
    let newQuantity = 0

    if (adjustmentType === "set") {
      newQuantity = quantity
    } else if (adjustmentType === "add") {
      newQuantity = oldQuantity + quantity
    } else if (adjustmentType === "subtract") {
      if (!existingStock) {
        return NextResponse.json(
          { error: "Cannot subtract from non-existent stock" },
          { status: 400 }
        )
      }
      newQuantity = Math.max(0, oldQuantity - quantity)
    } else {
      return NextResponse.json(
        { error: "Invalid adjustment type" },
        { status: 400 }
      )
    }

    // Calculate movement quantity before updating
    const movementQuantity = newQuantity - oldQuantity

    // Update or create stock
    const updatedStock = await prisma.stock.upsert({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
      update: {
        quantity: newQuantity,
        status: newQuantity === 0 
          ? "OUT_OF_STOCK" 
          : newQuantity < 10 
          ? "LOW_STOCK" 
          : "IN_STOCK",
      },
      create: {
        productId,
        warehouseId,
        quantity: newQuantity,
        reservedQuantity: 0,
        userId: currentUser.id,
        status: newQuantity === 0 
          ? "OUT_OF_STOCK" 
          : newQuantity < 10 
          ? "LOW_STOCK" 
          : "IN_STOCK",
      },
    })

    // Create stock movement record
    await prisma.stockMovement.create({
      data: {
        productId,
        warehouseId,
        type: "ADJUSTMENT",
        quantity: movementQuantity,
        reference: "Manual Adjustment",
        notes: notes || null,
        userId: currentUser.id,
      },
    })

    return NextResponse.json(updatedStock, { status: 201 })
  } catch (error: any) {
    if (error instanceof HttpError) throw error
    console.error("Error adjusting stock:", error)
    return NextResponse.json(
      { error: error.message || "Failed to adjust stock" },
      { status: 500 }
    )
  }
})

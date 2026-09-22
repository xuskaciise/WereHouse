import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { assertCanReference } from "@/lib/ownership"
import { HttpError, isAdmin } from "@/lib/auth-guard"
import { validateProductDates } from "@/lib/product-date-validation"

export const GET = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
      },
    })

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      )
    }
    if (!isAdmin(currentUser) && product.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(product)
  } catch (error) {
    if (error instanceof HttpError) throw error
    console.error("Error fetching product:", error)
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 }
    )
  }
})

export const PUT = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
    const body = await request.json()
    const {
      name,
      sku,
      description,
      categoryId,
      costPrice,
      sellingPrice,
      reorderLevel,
      issueDate,
      expireDate,
      productionDate,
      expiryDate,
      stockUpdates,
    } = body

    if (!name || !sku || !categoryId) {
      return NextResponse.json(
        { error: "Name, SKU, and Category are required" },
        { status: 400 }
      )
    }

    const normalizedProductionDate = productionDate || issueDate || null
    const normalizedExpiryDate = expiryDate || expireDate || null
    const dateError = validateProductDates({
      productionDate: normalizedProductionDate,
      expiryDate: normalizedExpiryDate,
    })

    if (dateError) {
      return NextResponse.json({ error: dateError }, { status: 400 })
    }

    const existingProduct = await prisma.product.findUnique({ where: { id } })
    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }
    if (!isAdmin(currentUser) && existingProduct.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    await assertCanReference(currentUser, { categoryId })

    const product = await prisma.product.update({
      where: { id },
      data: {
        name,
        sku,
        description: description || null,
        categoryId,
        costPrice: costPrice || 0,
        sellingPrice: sellingPrice || 0,
        reorderLevel: reorderLevel || 10,
        issueDate: normalizedProductionDate ? new Date(normalizedProductionDate) : null,
        expireDate: normalizedExpiryDate ? new Date(normalizedExpiryDate) : null,
      },
      include: {
        category: true,
      },
    })

    // Update stock quantities if provided
    if (stockUpdates && Array.isArray(stockUpdates)) {
      for (const update of stockUpdates) {
        const { stockId, quantity } = update
        if (stockId && quantity !== undefined) {
          try {
            // Only stock rows of this product may be edited through this route.
            await prisma.stock.update({
              where: { id: stockId, productId: id },
              data: {
                quantity: parseInt(quantity) || 0,
                status: parseInt(quantity) > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
              },
            })
          } catch (stockError) {
            console.error(`Error updating stock ${stockId}:`, stockError)
            // Continue with other updates even if one fails
          }
        }
      }
    }

    return NextResponse.json(product)
  } catch (error: any) {
    if (error instanceof HttpError) throw error
    console.error("Error updating product:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      )
    }

    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Product with this SKU already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Failed to update product" },
      { status: 500 }
    )
  }
})

export const DELETE = withAuth<{ id: string }>(async (request, { user: currentUser, params }) => {
  try {
    const { id } = params
    const existingProduct = await prisma.product.findUnique({ where: { id } })
    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }
    if (!isAdmin(currentUser) && existingProduct.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    await prisma.product.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Product deleted successfully" })
  } catch (error: any) {
    if (error instanceof HttpError) throw error
    console.error("Error deleting product:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      )
    }

    // Handle foreign key constraint (product has stock, orders, etc.)
    if (error.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete product that has stock or orders. Please remove all related data first." },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Failed to delete product" },
      { status: 500 }
    )
  }
})

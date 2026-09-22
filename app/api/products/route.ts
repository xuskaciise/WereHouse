import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { assertCanReference } from "@/lib/ownership"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { validateProductDates } from "@/lib/product-date-validation"

export const GET = withAuth(async (request, { user: currentUser }) => {
  try {
    const products = await prisma.product.findMany({
      where: ownershipWhere(currentUser),
      include: {
        category: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(products)
  } catch (error) {
    if (error instanceof HttpError) throw error
    console.error("Error fetching products:", error)
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    )
  }
})

export const POST = withAuth(async (request, { user: currentUser }) => {
  try {
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
      quantity,
      warehouseId,
    } = body

    if (!name || !sku || !categoryId) {
      return NextResponse.json(
        { error: "Name, SKU, and Category are required" },
        { status: 400 }
      )
    }

    await assertCanReference(currentUser, { categoryId, warehouseId })

    const normalizedProductionDate = productionDate || issueDate || null
    const normalizedExpiryDate = expiryDate || expireDate || null
    const dateError = validateProductDates({
      productionDate: normalizedProductionDate,
      expiryDate: normalizedExpiryDate,
    })

    if (dateError) {
      return NextResponse.json({ error: dateError }, { status: 400 })
    }

    const product = await prisma.product.create({
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
        userId: currentUser.id,
      },
      include: {
        category: true,
      },
    })

    // Create stock entry if quantity and warehouse are provided
    if (quantity && warehouseId && parseInt(quantity) > 0) {
      try {
        await prisma.stock.create({
          data: {
            productId: product.id,
            warehouseId: warehouseId,
            quantity: parseInt(quantity),
            reservedQuantity: 0,
            status: parseInt(quantity) > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
            userId: currentUser.id,
          },
        })
      } catch (stockError) {
        console.error("Error creating stock entry:", stockError)
        // Don't fail the product creation if stock creation fails
      }
    }

    return NextResponse.json(product, { status: 201 })
  } catch (error: any) {
    if (error instanceof HttpError) throw error
    console.error("Error creating product:", error)
    
    // Handle unique constraint violations
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Product with this SKU already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to create product" },
      { status: 500 }
    )
  }
})

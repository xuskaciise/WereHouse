import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(products)
  } catch (error) {
    console.error("Error fetching products:", error)
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, sku, description, categoryId, costPrice, sellingPrice, reorderLevel, quantity, warehouseId } = body

    if (!name || !sku || !categoryId) {
      return NextResponse.json(
        { error: "Name, SKU, and Category are required" },
        { status: 400 }
      )
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
          },
        })
      } catch (stockError) {
        console.error("Error creating stock entry:", stockError)
        // Don't fail the product creation if stock creation fails
      }
    }

    return NextResponse.json(product, { status: 201 })
  } catch (error: any) {
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
}

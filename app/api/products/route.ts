import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { validateProductDates } from "@/lib/product-date-validation"
import { incrementStock, parseQuantity } from "@/lib/stock"

export const GET = withAuth(async (_request, { user }) => {
  const products = await prisma.product.findMany({
    where: ownershipWhere(user),
    include: { category: true },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(products)
})

export const POST = withAuth(async (request, { user }) => {
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
  } = await readJson(request)

  if (!name || !sku || !categoryId) {
    throw new HttpError(400, "Name, SKU, and Category are required")
  }
  const initialQuantity =
    quantity !== undefined && quantity !== null && quantity !== "" ? parseQuantity(quantity, { allowZero: true }) : 0

  await assertCanReference(user, { categoryId, warehouseId })

  const normalizedProductionDate = productionDate || issueDate || null
  const normalizedExpiryDate = expiryDate || expireDate || null
  const dateError = validateProductDates({
    productionDate: normalizedProductionDate,
    expiryDate: normalizedExpiryDate,
  })
  if (dateError) throw new HttpError(400, dateError)

  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
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
          userId: user.id,
        },
        include: { category: true },
      })

      if (warehouseId && initialQuantity > 0) {
        await incrementStock(tx, {
          productId: created.id,
          warehouseId,
          quantity: initialQuantity,
          userId: user.id,
        })
        await tx.stockMovement.create({
          data: {
            productId: created.id,
            warehouseId,
            type: "IN",
            quantity: initialQuantity,
            reference: "Initial stock",
            userId: user.id,
          },
        })
      }

      return created
    })

    return NextResponse.json(product, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") throw new HttpError(409, "Product with this SKU already exists")
    throw error
  }
})

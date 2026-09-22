import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError, assertOwnership } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { parseMoney } from "@/lib/money"
import { validateProductDates } from "@/lib/product-date-validation"
import { parseQuantity, refreshStockStatus, setStockQuantity } from "@/lib/stock"

const NOT_FOUND = "Product not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { category: true },
  })
  assertOwnership(user, product, NOT_FOUND)
  return json(product)
})

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const { id } = params
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
  } = await readJson(request)

  if (!name || !sku || !categoryId) {
    throw new HttpError(400, "Name, SKU, and Category are required")
  }

  const normalizedProductionDate = productionDate || issueDate || null
  const normalizedExpiryDate = expiryDate || expireDate || null
  const dateError = validateProductDates({
    productionDate: normalizedProductionDate,
    expiryDate: normalizedExpiryDate,
  })
  if (dateError) throw new HttpError(400, dateError)

  const existing = await prisma.product.findUnique({ where: { id } })
  assertOwnership(user, existing, NOT_FOUND)
  await assertCanReference(user, { categoryId })

  const updates: { stockId: string; quantity: number }[] = Array.isArray(stockUpdates)
    ? stockUpdates
        .filter((u: any) => u?.stockId && u.quantity !== undefined)
        .map((u: any) => ({ stockId: String(u.stockId), quantity: parseQuantity(u.quantity, { allowZero: true }) }))
    : []

  const product = await withConflictMessages(
    () =>
      prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
          where: { id },
          data: {
            name,
            sku,
            description: description || null,
            categoryId,
            costPrice: parseMoney(costPrice ?? 0, { field: "Cost price", allowZero: true }),
            sellingPrice: parseMoney(sellingPrice ?? 0, { field: "Selling price", allowZero: true }),
            reorderLevel: reorderLevel === undefined || reorderLevel === null || reorderLevel === "" ? 10 : parseQuantity(reorderLevel, { allowZero: true }),
            issueDate: normalizedProductionDate ? new Date(normalizedProductionDate) : null,
            expireDate: normalizedExpiryDate ? new Date(normalizedExpiryDate) : null,
          },
          include: { category: true },
        })

        for (const update of updates) {
          // Only stock rows of this product can be edited through this route.
          const stock = await tx.stock.findFirst({
            where: { id: update.stockId, productId: id },
            select: { warehouseId: true },
          })
          if (!stock) throw new HttpError(400, "Invalid stock entry for this product")

          const { oldQuantity, newQuantity } = await setStockQuantity(tx, {
            productId: id,
            warehouseId: stock.warehouseId,
            quantity: update.quantity,
            userId: user.id,
          })
          if (newQuantity !== oldQuantity) {
            await tx.stockMovement.create({
              data: {
                productId: id,
                warehouseId: stock.warehouseId,
                type: "ADJUSTMENT",
                quantity: newQuantity - oldQuantity,
                reference: "Product edit",
                notes: "Stock updated from product form",
                userId: user.id,
              },
            })
          }
        }

        // The reorder level may have changed, so recompute every stock status.
        await refreshStockStatus(tx, id)
        return updated
      }),
    { unique: "Product with this SKU already exists" }
  )

  return json(product)
})

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const existing = await prisma.product.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  await withConflictMessages(() => prisma.product.delete({ where: { id: params.id } }), {
    inUse: "Cannot delete product that has stock or orders. Please remove all related data first.",
  })
  return json({ message: "Product deleted successfully" })
})

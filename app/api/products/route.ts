import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import { parseMoney } from "@/lib/money"
import { validateProductDates } from "@/lib/product-date-validation"
import { incrementStock, parseQuantity } from "@/lib/stock"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = scopeWhere(user, "products")
  return listResponse(request, {
    findMany: (page) =>
      prisma.product.findMany({ where, include: { category: true }, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.product.count({ where }),
  })
}, { permission: [["products", "view"], ["stock", "view"], ["sales", "create"], ["purchases", "create"]] }) // also a lookup for those forms

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

  const product = await withConflictMessages(
    () =>
      prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
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
      }, TX_OPTIONS),
    { unique: "Product with this SKU already exists" }
  )

  return json(product, { status: 201 })
}, { permission: ["products", "create"] })

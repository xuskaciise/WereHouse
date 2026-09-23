import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { decrementStock, incrementStock, parseQuantity, setStockQuantity } from "@/lib/stock"

export const POST = withAuth(async (request, { user }) => {
  const { productId, warehouseId, adjustmentType, quantity, notes } = await readJson(request)

  if (!productId || !warehouseId || adjustmentType === undefined || quantity === undefined) {
    throw new HttpError(400, "Product, Warehouse, Adjustment Type, and Quantity are required")
  }
  if (!["set", "add", "subtract"].includes(adjustmentType)) {
    throw new HttpError(400, "Invalid adjustment type")
  }
  const amount = parseQuantity(quantity, { allowZero: adjustmentType === "set" })

  await assertCanReference(user, { warehouseId, productIds: [productId] })

  const stock = await prisma.$transaction(async (tx) => {
    let delta: number
    if (adjustmentType === "add") {
      await incrementStock(tx, { productId, warehouseId, quantity: amount, userId: user.id })
      delta = amount
    } else if (adjustmentType === "subtract") {
      await decrementStock(tx, { productId, warehouseId, quantity: amount })
      delta = -amount
    } else {
      const { oldQuantity, newQuantity } = await setStockQuantity(tx, {
        productId,
        warehouseId,
        quantity: amount,
        userId: user.id,
      })
      delta = newQuantity - oldQuantity
    }

    if (delta !== 0) {
      await tx.stockMovement.create({
        data: {
          productId,
          warehouseId,
          type: "ADJUSTMENT",
          quantity: delta,
          reference: "Manual Adjustment",
          notes: notes || null,
          userId: user.id,
        },
      })
    }

    return tx.stock.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    })
  }, TX_OPTIONS)

  return json(stock, { status: 201 })
}, { permission: ["stock", "edit"] })

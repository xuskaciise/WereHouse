import type { Prisma } from "@prisma/client"
import { HttpError } from "@/lib/http-error"

// All stock quantity changes go through these helpers. They use single,
// guarded SQL statements (or a row lock for "set") so concurrent requests can
// never oversell or push a quantity below zero. The database also enforces
// quantity >= 0 with a CHECK constraint (see the init migration).

type Tx = Prisma.TransactionClient

interface StockKey {
  productId: string
  warehouseId: string
}

export function parseQuantity(value: unknown, { allowZero = false } = {}): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || (!allowZero && n === 0)) {
    throw new HttpError(
      400,
      allowZero ? "Quantity must be a whole number of 0 or more" : "Quantity must be a whole number greater than 0"
    )
  }
  return n
}

/**
 * Recomputes the status column from the current quantity and the product's
 * own reorder level, in one statement (no stale reads). Same rule as the Low
 * Stock page and the dashboard: LOW_STOCK when quantity <= reorderLevel.
 */
export async function refreshStockStatus(tx: Tx, productId: string, warehouseId?: string): Promise<void> {
  if (warehouseId) {
    await tx.$executeRaw`
      UPDATE "stock" AS s
      SET "status" = (CASE
            WHEN s."quantity" <= 0 THEN 'OUT_OF_STOCK'
            WHEN s."quantity" <= p."reorderLevel" THEN 'LOW_STOCK'
            ELSE 'IN_STOCK' END)::"StockStatus"
      FROM "products" AS p
      WHERE p."id" = s."productId" AND s."productId" = ${productId} AND s."warehouseId" = ${warehouseId}`
  } else {
    await tx.$executeRaw`
      UPDATE "stock" AS s
      SET "status" = (CASE
            WHEN s."quantity" <= 0 THEN 'OUT_OF_STOCK'
            WHEN s."quantity" <= p."reorderLevel" THEN 'LOW_STOCK'
            ELSE 'IN_STOCK' END)::"StockStatus"
      FROM "products" AS p
      WHERE p."id" = s."productId" AND s."productId" = ${productId}`
  }
}

/** Starting average cost of a new stock row: the product's cost price. */
async function initialAvgCost(tx: Tx, productId: string) {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { costPrice: true } })
  return product?.costPrice ?? 0
}

/**
 * Adds units (creating the stock row if needed) at the current average cost,
 * e.g. a manual stock adjustment. Purchase receipts use receiveIntoStock()
 * (lib/stock-valuation.ts), which re-weights the average. Returns the new quantity.
 */
export async function incrementStock(
  tx: Tx,
  { productId, warehouseId, quantity, userId }: StockKey & { quantity: number; userId: string }
): Promise<number> {
  const stock = await tx.stock.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: { quantity: { increment: quantity } },
    create: { productId, warehouseId, quantity, reservedQuantity: 0, userId, avgCost: await initialAvgCost(tx, productId) },
    select: { quantity: true },
  })
  await refreshStockStatus(tx, productId, warehouseId)
  return stock.quantity
}

/**
 * Removes units only if enough unreserved stock is available, as a single
 * conditional UPDATE. Throws 400 (and changes nothing) otherwise.
 */
export async function decrementStock(
  tx: Tx,
  { productId, warehouseId, quantity }: StockKey & { quantity: number }
): Promise<number> {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    UPDATE "stock"
    SET "quantity" = "quantity" - ${quantity}, "updatedAt" = NOW()
    WHERE "productId" = ${productId}
      AND "warehouseId" = ${warehouseId}
      AND "quantity" - "reservedQuantity" >= ${quantity}
    RETURNING "quantity"`

  if (rows.length === 0) {
    const current = await tx.stock.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { quantity: true, reservedQuantity: true, product: { select: { name: true } } },
    })
    if (!current) throw new HttpError(400, "No stock found for this product in the selected warehouse")
    const available = current.quantity - current.reservedQuantity
    throw new HttpError(
      400,
      `Insufficient stock for ${current.product.name}. Available: ${available}, Requested: ${quantity}`
    )
  }

  await refreshStockStatus(tx, productId, warehouseId)
  return rows[0].quantity
}

/**
 * Sets an absolute quantity under a row lock. Returns the old and new
 * quantity so the caller can record the movement delta.
 */
export async function setStockQuantity(
  tx: Tx,
  { productId, warehouseId, quantity, userId }: StockKey & { quantity: number; userId: string }
): Promise<{ oldQuantity: number; newQuantity: number }> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new HttpError(400, "Quantity must be a whole number of 0 or more")
  }

  const locked = await tx.$queryRaw<{ quantity: number; reservedQuantity: number }[]>`
    SELECT "quantity", "reservedQuantity" FROM "stock"
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
    FOR UPDATE`

  if (locked.length === 0) {
    await tx.stock.create({
      data: { productId, warehouseId, quantity, reservedQuantity: 0, userId, avgCost: await initialAvgCost(tx, productId) },
    })
    await refreshStockStatus(tx, productId, warehouseId)
    return { oldQuantity: 0, newQuantity: quantity }
  }

  const { quantity: oldQuantity, reservedQuantity } = locked[0]
  if (quantity < reservedQuantity) {
    throw new HttpError(400, `Quantity cannot be lower than the reserved quantity (${reservedQuantity})`)
  }

  await tx.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { quantity },
  })
  await refreshStockStatus(tx, productId, warehouseId)
  return { oldQuantity, newQuantity: quantity }
}

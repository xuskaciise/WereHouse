import type { Prisma } from "@prisma/client"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, roundMoney } from "@/lib/money"
import { decrementStock, refreshStockStatus } from "@/lib/stock"

// Weighted average cost per product and warehouse (stock.avgCost, 4 decimals).
//
//   receive q units worth V:  avg = (qty x avg + V) / (qty + q)
//   revalue by D (landed cost change for units in stock): avg = avg + D / qty
//   sale: the current avg is the unit cost of the sold units (COGS)
//   transfer: units leave at the source avg and arrive at the destination
//             like a receipt, so the destination avg is re-weighted
//
// Every value change is written to inventory_valuation_entries.

type Tx = Prisma.TransactionClient

export function roundUnitCost(value: Prisma.Decimal.Value): Money {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
}

interface LockedStock {
  id: string
  quantity: number
  avgCost: Money
}

/** Locks the stock row (FOR UPDATE) so concurrent receipts/sales see a consistent average. */
export async function lockStock(tx: Tx, productId: string, warehouseId: string): Promise<LockedStock | null> {
  const rows = await tx.$queryRaw<{ id: string; quantity: number; avgCost: Prisma.Decimal }[]>`
    SELECT "id", "quantity", "avgCost" FROM "stock"
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
    FOR UPDATE`
  return rows[0] ? { id: rows[0].id, quantity: rows[0].quantity, avgCost: new Decimal(rows[0].avgCost) } : null
}

/** Current average unit cost (0 when there is no stock row). */
export async function averageCost(tx: Tx, productId: string, warehouseId: string): Promise<Money> {
  return (await lockStock(tx, productId, warehouseId))?.avgCost ?? ZERO
}

/**
 * Adds `quantity` units with a total value `value` (goods + landed costs) and
 * re-weights the average. Creates the stock row if needed.
 */
export async function receiveIntoStock(
  tx: Tx,
  input: {
    productId: string
    warehouseId: string
    quantity: number
    value: Money
    userId: string
    purchaseOrderItemId?: string
    entryType?: "RECEIPT" | "TRANSFER_IN"
  }
): Promise<Money> {
  const { productId, warehouseId, quantity, value, userId } = input
  const stock = await lockStock(tx, productId, warehouseId)
  let avg: Money
  if (!stock) {
    avg = roundUnitCost(value.div(quantity))
    await tx.stock.create({ data: { productId, warehouseId, quantity, reservedQuantity: 0, avgCost: avg, userId } })
  } else {
    const total = stock.quantity + quantity
    avg = roundUnitCost(stock.avgCost.times(stock.quantity).plus(value).div(total))
    await tx.stock.update({ where: { id: stock.id }, data: { quantity: { increment: quantity }, avgCost: avg } })
  }
  await refreshStockStatus(tx, productId, warehouseId)
  await tx.inventoryValuationEntry.create({
    data: {
      type: input.entryType ?? "RECEIPT",
      productId,
      warehouseId,
      quantity,
      amount: roundMoney(value),
      purchaseOrderItemId: input.purchaseOrderItemId ?? null,
      userId,
    },
  })
  return avg
}

/**
 * Applies a landed cost change `delta` to `receivedUnits` units received from
 * one PO line. AVERAGE-COST APPROXIMATION (average cost does not track which
 * units were sold): the share still in stock is min(stock, received) /
 * received; that share revalues the warehouse average, the rest belongs to
 * units already sold and is booked as a COGS adjustment (profit reports).
 */
export async function applyLandedCostDelta(
  tx: Tx,
  input: {
    productId: string
    warehouseId: string
    receivedUnits: number
    delta: Money
    userId: string
    purchaseOrderItemId: string
    landedCostId?: string | null
  }
): Promise<{ stockPart: Money; cogsPart: Money }> {
  const { productId, warehouseId, receivedUnits, delta, userId } = input
  if (delta.isZero() || receivedUnits <= 0) return { stockPart: ZERO, cogsPart: ZERO }

  const stock = await lockStock(tx, productId, warehouseId)
  const inStock = Math.min(stock?.quantity ?? 0, receivedUnits)
  const stockPart = roundMoney(delta.times(inStock).div(receivedUnits))
  const cogsPart = delta.minus(stockPart)

  if (!stockPart.isZero() && stock && stock.quantity > 0) {
    const avg = roundUnitCost(stock.avgCost.plus(stockPart.div(stock.quantity)))
    if (avg.isNegative()) throw new HttpError(400, "This change would make the average cost negative")
    await tx.stock.update({ where: { id: stock.id }, data: { avgCost: avg } })
  }
  const base = { productId, warehouseId, userId, purchaseOrderItemId: input.purchaseOrderItemId, landedCostId: input.landedCostId ?? null }
  if (!stockPart.isZero()) {
    await tx.inventoryValuationEntry.create({ data: { ...base, type: "LANDED_COST", quantity: inStock, amount: stockPart } })
  }
  if (!cogsPart.isZero()) {
    await tx.inventoryValuationEntry.create({
      data: { ...base, type: "COGS_ADJUSTMENT", quantity: receivedUnits - inStock, amount: cogsPart },
    })
  }
  return { stockPart, cogsPart }
}

/**
 * Moves units between warehouses carrying the source average cost (used by
 * the stock transfer feature). Guarded like a sale: fails if not enough
 * unreserved stock.
 */
export async function transferWithCost(
  tx: Tx,
  input: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; userId: string }
): Promise<{ unitCost: Money; value: Money }> {
  const { productId, fromWarehouseId, toWarehouseId, quantity, userId } = input
  if (fromWarehouseId === toWarehouseId) throw new HttpError(400, "Source and destination warehouse must differ")
  const unitCost = await averageCost(tx, productId, fromWarehouseId)
  await decrementStock(tx, { productId, warehouseId: fromWarehouseId, quantity })
  const value = roundMoney(unitCost.times(quantity))
  await tx.inventoryValuationEntry.create({
    data: { type: "TRANSFER_OUT", productId, warehouseId: fromWarehouseId, quantity, amount: value, userId },
  })
  await receiveIntoStock(tx, { productId, warehouseId: toWarehouseId, quantity, value, userId, entryType: "TRANSFER_IN" })
  return { unitCost, value }
}

import { OrderStatus, Prisma } from "@prisma/client"
import { HttpError } from "@/lib/http-error"
import { type Money, ZERO, parseMoney, roundMoney, sumMoney } from "@/lib/money"
import { parseQuantity } from "@/lib/stock"

export interface OrderItemInput {
  productId: string
  quantity: number
  unitPrice: Money
  subtotal: Money
}

export function parseOrderItems(items: unknown): OrderItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "At least one item is required")
  }
  return items.map((item: any) => {
    if (!item || typeof item.productId !== "string" || !item.productId) {
      throw new HttpError(400, "Each item needs a product")
    }
    const quantity = parseQuantity(item.quantity)
    const unitPrice = parseMoney(item.unitPrice, { field: "Unit price", allowZero: true })
    return { productId: item.productId, quantity, unitPrice, subtotal: roundMoney(unitPrice.times(quantity)) }
  })
}

/** Order totals in Decimal. `taxRatePercent` is a percentage, e.g. 8 for 8%. */
export function calculateOrderTotals(items: OrderItemInput[], taxRatePercent: Prisma.Decimal.Value) {
  const subtotal = sumMoney(items.map((item) => item.subtotal))
  const tax = roundMoney(subtotal.times(taxRatePercent).div(100))
  const discount = ZERO
  const total = subtotal.plus(tax).minus(discount)
  return { subtotal, tax, discount, total }
}

const ORDER_STATUSES = new Set<string>(Object.values(OrderStatus))

export function parseOrderStatus(value: unknown, fallback: OrderStatus = "PENDING"): OrderStatus {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value !== "string" || !ORDER_STATUSES.has(value)) throw new HttpError(400, "Invalid order status")
  return value as OrderStatus
}

function isOrderNumberConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    /orderNumber|transferNumber/.test(JSON.stringify(error.meta ?? {}))
  )
}

/**
 * Creates an order with the next sequential number (e.g. SO-000042). If two
 * requests race for the same number, the unique index rejects one and it is
 * retried with the next number instead of failing.
 */
export async function createWithOrderNumber<T>(
  prefix: "PO" | "SO" | "TR",
  currentCount: () => Promise<number>,
  create: (orderNumber: string) => Promise<T>
): Promise<T> {
  const MAX_ATTEMPTS = 5
  for (let attempt = 0; ; attempt++) {
    const next = (await currentCount()) + 1 + attempt
    try {
      return await create(`${prefix}-${String(next).padStart(6, "0")}`)
    } catch (error) {
      if (!isOrderNumberConflict(error) || attempt + 1 >= MAX_ATTEMPTS) throw error
    }
  }
}

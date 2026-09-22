import { OrderStatus } from "@prisma/client"
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

/** Order totals in Decimal. `taxRate` is a fraction, e.g. "0.08" for 8%. */
export function calculateOrderTotals(items: OrderItemInput[], taxRate: string) {
  const subtotal = sumMoney(items.map((item) => item.subtotal))
  const tax = roundMoney(subtotal.times(taxRate))
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

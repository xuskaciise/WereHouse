import { OrderStatus } from "@prisma/client"
import { HttpError } from "@/lib/auth-guard"
import { parseQuantity } from "@/lib/stock"

export interface OrderItemInput {
  productId: string
  quantity: number
  unitPrice: number
}

export function parseOrderItems(items: unknown): OrderItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "At least one item is required")
  }
  return items.map((item: any) => {
    if (!item || typeof item.productId !== "string" || !item.productId) {
      throw new HttpError(400, "Each item needs a product")
    }
    const unitPrice = Number(item.unitPrice)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new HttpError(400, "Unit price must be a number of 0 or more")
    }
    return { productId: item.productId, quantity: parseQuantity(item.quantity), unitPrice }
  })
}

const ORDER_STATUSES = new Set<string>(Object.values(OrderStatus))

export function parseOrderStatus(value: unknown, fallback: OrderStatus = "PENDING"): OrderStatus {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value !== "string" || !ORDER_STATUSES.has(value)) throw new HttpError(400, "Invalid order status")
  return value as OrderStatus
}

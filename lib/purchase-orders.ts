import type { OrderStatus, Prisma } from "@prisma/client"
import { HttpError } from "@/lib/http-error"
import { roundMoney, sumMoney } from "@/lib/money"
import { ADJUSTMENT_REASON_MAX_LENGTH, PURCHASE_TAX_RATE } from "@/lib/purchase-rules"

type Tx = Prisma.TransactionClient

const userSummary = { select: { id: true, name: true, username: true } } as const

export const purchaseOrderDetailInclude = {
  supplier: true,
  warehouse: true,
  user: userSummary,
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      product: true,
      receiveItems: true,
      adjustments: { orderBy: { createdAt: "asc" as const }, include: { user: userSummary } },
    },
  },
  receives: {
    orderBy: { createdAt: "desc" as const },
    include: { user: userSummary, items: true },
  },
} satisfies Prisma.PurchaseOrderInclude

export function totalReceived(item: { receiveItems: { quantityReceived: number }[] }): number {
  return item.receiveItems.reduce((sum, r) => sum + r.quantityReceived, 0)
}

/** Trimmed reason, or null. Throws 400 when `required` and missing, or when too long. */
export function parseReason(value: unknown, { required, label }: { required: boolean; label: string }): string | null {
  const reason = typeof value === "string" ? value.trim() : ""
  if (!reason) {
    if (required) throw new HttpError(400, `A reason is required for ${label}`)
    return null
  }
  if (reason.length > ADJUSTMENT_REASON_MAX_LENGTH) {
    throw new HttpError(400, `Reason must be at most ${ADJUSTMENT_REASON_MAX_LENGTH} characters`)
  }
  return reason
}

/** Sets a line's quantity and its subtotal (unit price x quantity, in Decimal). */
export async function setItemQuantity(
  tx: Tx,
  item: { id: string; unitPrice: Prisma.Decimal },
  quantity: number,
  extra: { closed?: boolean } = {}
): Promise<void> {
  await tx.purchaseOrderItem.update({
    where: { id: item.id },
    data: { quantity, subtotal: roundMoney(item.unitPrice.times(quantity)), ...extra },
  })
}

/**
 * Recomputes subtotal, tax and total from the stored line subtotals (never
 * from client input). The discount is kept as it is.
 */
export async function recalculatePurchaseOrderTotals(tx: Tx, purchaseOrderId: string): Promise<void> {
  const [po, items] = await Promise.all([
    tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { discount: true } }),
    tx.purchaseOrderItem.findMany({ where: { purchaseOrderId }, select: { subtotal: true } }),
  ])
  const subtotal = sumMoney(items.map((item) => item.subtotal))
  const tax = roundMoney(subtotal.times(PURCHASE_TAX_RATE))
  const total = subtotal.plus(tax).minus(po.discount)
  if (total.isNegative()) throw new HttpError(400, "The order total cannot be negative")
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { subtotal, tax, total } })
}

/**
 * CONFIRMED (shown as "Received") when every line is fully received or
 * closed (closing sets quantity = received), PARTIALLY_RECEIVED when
 * anything arrived, otherwise PENDING.
 */
export async function recomputePurchaseOrderStatus(tx: Tx, purchaseOrderId: string): Promise<void> {
  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    include: { receiveItems: true },
  })

  let allComplete = items.length > 0
  let anyReceived = false
  for (const item of items) {
    const received = totalReceived(item)
    if (received < item.quantity) allComplete = false
    if (received > 0) anyReceived = true
  }

  const status: OrderStatus = allComplete ? "CONFIRMED" : anyReceived ? "PARTIALLY_RECEIVED" : "PENDING"
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status } })
}

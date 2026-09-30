import type { Prisma, ReturnCondition } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, ZERO, parseMoney, roundMoney, sumMoney } from "@/lib/money"
import { nextDocumentNumber } from "@/lib/orders"
import { parsePaymentFields } from "@/lib/payment-fields"
import { type PermissionUser, hasPermission, isOwnScope, requirePermission } from "@/lib/permissions"
import { computeDelivery } from "@/lib/sales-orders"
import { receiveIntoStock } from "@/lib/stock-valuation"
import type { SessionUser } from "@/lib/auth-guard"
import { postAccounting } from "@/lib/accounting"

// Sales returns: delivered goods taken back from the customer (credit note
// SR-000001).
//
//   returnable per line = delivered - already returned
//   money               the returned share of the line amounts and of the
//                       order discount and tax, computed exactly like a
//                       delivery (cumulative shares), so returning everything
//                       that was delivered reverses exactly what was invoiced
//   revenue / COGS      reversed (profit reports subtract the returns in the
//                       period); COGS at the line's ORIGINAL unit cost
//   RESELLABLE          stock IN at that original unit cost (average re-weighted)
//   DAMAGED             no stock; the original cost is booked as a loss
//   customer balance    down by the credit note total; an optional refund
//                       (any payment method incl. EVC Plus / ZAAD / E-Dahab)
//                       raises it again
// Returns are final.

type Tx = Prisma.TransactionClient

const CONDITIONS: ReturnCondition[] = ["RESELLABLE", "DAMAGED"]
const userSelect = { select: { id: true, name: true, username: true } } as const

function text(value: unknown, label: string, { required, max }: { required: boolean; max: number }): string | null {
  const v = typeof value === "string" ? value.trim() : ""
  if (!v) {
    if (required) throw new HttpError(400, `${label} is required`)
    return null
  }
  if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`)
  return v
}

/** Sales order visible to the user (sales scope) - 404 otherwise. */
async function assertOrderVisible(user: PermissionUser, salesOrderId: string) {
  const order = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, select: { id: true, userId: true } })
  if (!order || (isOwnScope(user, "sales") && order.userId !== user.id)) throw new HttpError(404, "Sales order not found")
  if (isOwnScope(user, "sales_returns") && order.userId !== user.id) {
    throw new HttpError(403, "You can only take returns for your own sales orders")
  }
  return order
}

/** Lines of an order with what can still be returned (for the return form). */
export async function returnableSalesLines(user: PermissionUser, salesOrderId: string) {
  await assertOrderVisible(user, salesOrderId)
  const order = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: salesOrderId },
    include: {
      customer: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      items: { orderBy: { id: "asc" }, include: { product: { select: { id: true, name: true, sku: true } } } },
    },
  })
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customer: order.customer,
    warehouse: order.warehouse,
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    lines: order.items.map((i) => ({
      itemId: i.id,
      product: i.product,
      quantity: i.quantity,
      subtotal: i.subtotal,
      delivered: i.deliveredQuantity,
      returned: i.returnedQuantity,
      returnable: i.deliveredQuantity - i.returnedQuantity,
    })),
  }
}

/**
 * Body: { salesOrderId, lines: [{ itemId, quantity, condition }], reason, notes?,
 *         refund?: { amount, paymentMethod, payerPhone?, transactionId?, reference? } }
 */
export async function createSalesReturn(user: SessionUser, body: any): Promise<string> {
  const salesOrderId = typeof body?.salesOrderId === "string" ? body.salesOrderId : ""
  if (!salesOrderId) throw new HttpError(400, "salesOrderId is required")
  await assertOrderVisible(user, salesOrderId)
  const reason = text(body?.reason, "A reason for the return", { required: true, max: 500 })!
  const notes = text(body?.notes, "Notes", { required: false, max: 1000 })

  if (!Array.isArray(body?.lines)) throw new HttpError(400, "lines must be a list")
  // One entry per line and condition (a line may be split: some resellable, some damaged).
  const requested: { itemId: string; quantity: number; condition: ReturnCondition }[] = []
  for (const line of body.lines) {
    const itemId = typeof line?.itemId === "string" ? line.itemId : ""
    const quantity = Number(line?.quantity ?? 0)
    const condition = line?.condition as ReturnCondition
    if (!itemId) throw new HttpError(400, "Each line needs an itemId")
    if (!Number.isInteger(quantity) || quantity < 0) throw new HttpError(400, "Quantities must be whole numbers of 0 or more")
    if (quantity === 0) continue
    if (!CONDITIONS.includes(condition)) throw new HttpError(400, "Each returned line needs a condition: RESELLABLE or DAMAGED")
    const same = requested.find((r) => r.itemId === itemId && r.condition === condition)
    if (same) same.quantity += quantity
    else requested.push({ itemId, quantity, condition })
  }
  if (requested.length === 0) throw new HttpError(400, "Enter at least one quantity to return")

  let refund: { amount: Money; method: Awaited<ReturnType<typeof parsePaymentFields>>; reference: string | null } | null = null
  if (body?.refund) {
    requirePermission(user, ["customer_payments", "create"], "You are not allowed to record customer refunds")
    const amount = parseMoney(body.refund.amount, { field: "Refund amount", allowZero: true })
    if (amount.gt(0)) {
      refund = {
        amount,
        method: await parsePaymentFields(body.refund),
        reference: text(body.refund.reference, "Refund reference", { required: false, max: 100 }),
      }
    }
  }

  return prisma.$transaction(async (tx: Tx) => {
    // Lock the order: returns and deliveries of the same order are serialized.
    await tx.$queryRaw`SELECT "id" FROM "sales_orders" WHERE "id" = ${salesOrderId} FOR UPDATE`
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      include: { items: { orderBy: { id: "asc" }, include: { product: { select: { name: true } } } } },
    })

    const perItem = new Map<string, number>()
    for (const r of requested) perItem.set(r.itemId, (perItem.get(r.itemId) ?? 0) + r.quantity)
    for (const [itemId, quantity] of perItem) {
      const item = order.items.find((i) => i.id === itemId)
      if (!item) throw new HttpError(400, "Line not found on this order")
      const returnable = item.deliveredQuantity - item.returnedQuantity
      if (quantity > returnable) {
        throw new HttpError(400, `${item.product.name}: only ${returnable} delivered unit(s) can still be returned`)
      }
    }

    // Money: like a delivery, measured on the returned quantities.
    const money = computeDelivery(
      { ...order, items: order.items.map((i) => ({ ...i, deliveredQuantity: i.returnedQuantity })) },
      perItem
    )
    if (refund && refund.amount.gt(money.total)) {
      throw new HttpError(400, `The refund cannot be more than the credit note of ${money.total.toFixed(2)}`)
    }

    const returnNumber = await nextDocumentNumber(tx, "SR", "sales_returns", "returnNumber")
    const rows: Prisma.SalesReturnItemCreateManySalesReturnInput[] = []
    for (const line of money.lines) {
      const { item } = line
      // Split the line's money over its condition entries (by quantity).
      const parts = requested.filter((r) => r.itemId === item.id)
      let rest = { quantity: line.quantity, amount: line.amount, discount: line.discount, tax: line.tax }
      parts.forEach((part, index) => {
        const last = index === parts.length - 1
        const share = (v: Money) => (last ? v : roundMoney(v.times(part.quantity).div(rest.quantity)))
        const amount = share(rest.amount)
        const discount = share(rest.discount)
        const tax = share(rest.tax)
        rows.push({
          salesOrderItemId: item.id,
          productId: item.productId,
          quantity: part.quantity,
          condition: part.condition,
          amount,
          discount,
          tax,
          // COGS reversed at the ORIGINAL unit cost of the delivered units.
          unitCost: item.unitCost,
          cogs: roundMoney(item.unitCost.times(part.quantity)),
        })
        rest = {
          quantity: rest.quantity - part.quantity,
          amount: rest.amount.minus(amount),
          discount: rest.discount.minus(discount),
          tax: rest.tax.minus(tax),
        }
      })
      await tx.salesOrderItem.update({ where: { id: item.id }, data: { returnedQuantity: { increment: line.quantity } } })
    }
    const cogs = sumMoney(rows.map((r) => r.cogs as Money))
    const lossValue = sumMoney(rows.filter((r) => r.condition === "DAMAGED").map((r) => r.cogs as Money))

    const created = await tx.salesReturn.create({
      data: {
        returnNumber,
        salesOrderId: order.id,
        customerId: order.customerId,
        warehouseId: order.warehouseId,
        reason,
        notes,
        subtotal: money.subtotal,
        discount: money.discount,
        tax: money.tax,
        total: money.total,
        cogs,
        lossValue,
        refundAmount: refund?.amount ?? ZERO,
        refundMethod: refund?.method.paymentMethod ?? null,
        payerPhone: refund?.method.payerPhone ?? null,
        transactionId: refund?.method.transactionId ?? null,
        refundReference: refund?.reference ?? null,
        userId: user.id,
        items: { createMany: { data: rows } },
      },
    })

    for (const row of rows) {
      const value = row.cogs as Money
      if (row.condition === "RESELLABLE") {
        await receiveIntoStock(tx, {
          productId: row.productId,
          warehouseId: order.warehouseId,
          quantity: row.quantity,
          value,
          userId: user.id,
          entryType: "SALES_RETURN",
        })
        await tx.stockMovement.create({
          data: {
            productId: row.productId,
            warehouseId: order.warehouseId,
            type: "IN",
            quantity: row.quantity,
            reference: returnNumber,
            referenceId: created.id,
            notes: `Customer return (${order.orderNumber}): ${reason}`.slice(0, 500),
            userId: user.id,
          },
        })
      } else {
        await tx.inventoryValuationEntry.create({
          data: {
            type: "SALES_RETURN_LOSS",
            productId: row.productId,
            warehouseId: order.warehouseId,
            quantity: row.quantity,
            amount: value,
            userId: user.id,
          },
        })
      }
    }
    await tx.salesOrderEvent.create({
      data: {
        salesOrderId: order.id,
        type: "RETURNED",
        userId: user.id,
        notes: reason,
        data: { returnNumber, total: money.total.toFixed(2), lines: rows.map((r) => ({ itemId: r.salesOrderItemId, quantity: r.quantity, condition: r.condition })) },
      },
    })
    await postAccounting(tx, {}, user.id)
    return created.id
  }, TX_OPTIONS)
}

export const salesReturnInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
  warehouse: { select: { id: true, name: true } },
  salesOrder: { select: { id: true, orderNumber: true, orderDate: true } },
  user: userSelect,
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
} satisfies Prisma.SalesReturnInclude

export async function salesReturnDetail(user: PermissionUser, id: string) {
  const row = await prisma.salesReturn.findUnique({ where: { id }, include: salesReturnInclude })
  if (!row || (isOwnScope(user, "sales_returns") && row.userId !== user.id)) throw new HttpError(404, "Sales return not found")
  if (!hasPermission(user, ["product_cost", "view"])) {
    return {
      ...row,
      cogs: undefined,
      lossValue: undefined,
      items: row.items.map((i) => ({ ...i, unitCost: undefined, cogs: undefined })),
    }
  }
  return row
}

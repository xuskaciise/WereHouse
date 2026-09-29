import type { Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, ZERO, parseMoney, roundMoney, sumMoney } from "@/lib/money"
import { nextDocumentNumber } from "@/lib/orders"
import { parsePaymentFields } from "@/lib/payment-fields"
import { type PermissionUser, hasPermission, isOwnScope, requirePermission } from "@/lib/permissions"
import { decrementStock } from "@/lib/stock"
import { averageCost } from "@/lib/stock-valuation"
import type { SessionUser } from "@/lib/auth-guard"

// Purchase returns: received goods sent back to the supplier (PR-000001).
//
//   returnable per line = received - already returned (never more)
//   stock               OUT at the warehouse average (landed) cost, guarded
//                       like a sale (reserved units cannot be returned)
//   supplier credit     unit price x quantity, less the share of the order
//                       discount, plus the share of the tax (same proportions
//                       as the order): the supplier balance goes down by it
//   refund (optional)   money the supplier pays back now, with a payment
//                       method (incl. EVC Plus / ZAAD / E-Dahab); it raises
//                       the balance again (credit used up)
//   costValue - (credit - tax) is the return difference: usually the landed
//   cost of the returned units that the supplier does not pay back.
// Returns are final: a mistake is corrected with a new purchase / receive.

type Tx = Prisma.TransactionClient

const userSelect = { select: { id: true, name: true, username: true } } as const

function totalOf(rows: { quantityReceived?: number; quantity?: number }[], key: "quantityReceived" | "quantity") {
  return rows.reduce((sum, r) => sum + (r[key] ?? 0), 0)
}

/** Purchase order visible to the user (purchases scope) - 404 otherwise. */
async function assertOrderVisible(user: PermissionUser, purchaseOrderId: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, select: { id: true, userId: true } })
  if (!po || (isOwnScope(user, "purchases") && po.userId !== user.id)) throw new HttpError(404, "Purchase order not found")
  return po
}

/** Lines of a PO with what can still be returned (for the return form). */
export async function returnableLines(user: PermissionUser, purchaseOrderId: string) {
  await assertOrderVisible(user, purchaseOrderId)
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: {
      supplier: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          receiveItems: { select: { quantityReceived: true } },
          returnItems: { select: { quantity: true } },
        },
      },
    },
  })
  const seesCost = hasPermission(user, ["product_cost", "view"])
  const stock = await prisma.stock.findMany({
    where: { warehouseId: po.warehouseId, productId: { in: po.items.map((i) => i.productId) } },
    select: { productId: true, quantity: true, reservedQuantity: true, avgCost: true },
  })
  const stockOf = new Map(stock.map((s) => [s.productId, s]))
  return {
    id: po.id,
    orderNumber: po.orderNumber,
    status: po.status,
    supplier: po.supplier,
    warehouse: po.warehouse,
    // For the credit preview (the server recalculates on save).
    subtotal: po.subtotal,
    discount: po.discount,
    tax: po.tax,
    lines: po.items.map((i) => {
      const received = totalOf(i.receiveItems, "quantityReceived")
      const returned = totalOf(i.returnItems, "quantity")
      const s = stockOf.get(i.productId)
      return {
        itemId: i.id,
        product: i.product,
        unitPrice: i.unitPrice,
        received,
        returned,
        returnable: Math.max(0, received - returned),
        available: s ? s.quantity - s.reservedQuantity : 0,
        ...(seesCost && { avgCost: s?.avgCost ?? ZERO }),
      }
    }),
  }
}

function text(value: unknown, label: string, { required, max }: { required: boolean; max: number }): string | null {
  const v = typeof value === "string" ? value.trim() : ""
  if (!v) {
    if (required) throw new HttpError(400, `${label} is required`)
    return null
  }
  if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`)
  return v
}

/**
 * Body: { purchaseOrderId, lines: [{ itemId, quantity }], reason, notes?,
 *         refund?: { amount, paymentMethod, payerPhone?, transactionId?, reference? } }
 */
export async function createPurchaseReturn(user: SessionUser, body: any): Promise<string> {
  const purchaseOrderId = typeof body?.purchaseOrderId === "string" ? body.purchaseOrderId : ""
  if (!purchaseOrderId) throw new HttpError(400, "purchaseOrderId is required")
  await assertOrderVisible(user, purchaseOrderId)
  const reason = text(body?.reason, "A reason for the return", { required: true, max: 500 })!
  const notes = text(body?.notes, "Notes", { required: false, max: 1000 })

  if (!Array.isArray(body?.lines)) throw new HttpError(400, "lines must be a list")
  const requested = new Map<string, number>()
  for (const line of body.lines) {
    const itemId = typeof line?.itemId === "string" ? line.itemId : ""
    const quantity = Number(line?.quantity ?? 0)
    if (!itemId) throw new HttpError(400, "Each line needs an itemId")
    if (!Number.isInteger(quantity) || quantity < 0) throw new HttpError(400, "Quantities must be whole numbers of 0 or more")
    if (quantity > 0) requested.set(itemId, (requested.get(itemId) ?? 0) + quantity)
  }
  if (requested.size === 0) throw new HttpError(400, "Enter at least one quantity to return")

  let refund: { amount: Money; method: Awaited<ReturnType<typeof parsePaymentFields>>; reference: string | null } | null = null
  if (body?.refund) {
    requirePermission(user, ["supplier_payments", "create"], "You are not allowed to record supplier refunds")
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
    // Lock the order: concurrent returns / receives are serialized, so the
    // returnable quantities below cannot be raced.
    await tx.$queryRaw`SELECT "id" FROM "purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { items: { include: { product: { select: { name: true } }, receiveItems: true, returnItems: true } } },
    })
    if (po.status === "CANCELLED") throw new HttpError(400, "A cancelled purchase order has no goods to return")

    const lines = [...requested].map(([itemId, quantity]) => {
      const item = po.items.find((i) => i.id === itemId)
      if (!item) throw new HttpError(400, "Line not found on this purchase order")
      const returnable = totalOf(item.receiveItems, "quantityReceived") - totalOf(item.returnItems, "quantity")
      if (quantity > returnable) {
        throw new HttpError(400, `${item.product.name}: only ${Math.max(0, returnable)} received unit(s) can still be returned`)
      }
      return { item, quantity, amount: roundMoney(item.unitPrice.times(quantity)) }
    })

    // Supplier credit: goods at the order price, with the goods' share of the
    // order discount and tax (the order's own proportions).
    const goodsAmount = sumMoney(lines.map((l) => l.amount))
    const share = (value: Money) => (po.subtotal.isZero() ? ZERO : roundMoney(value.times(goodsAmount).div(po.subtotal)))
    const discount = share(po.discount)
    const tax = share(po.tax)
    const creditTotal = goodsAmount.minus(discount).plus(tax)
    if (creditTotal.isNegative()) throw new HttpError(400, "The credit of this return would be negative")
    if (refund && refund.amount.gt(creditTotal)) {
      throw new HttpError(400, `The refund cannot be more than the credit of ${creditTotal.toFixed(2)}`)
    }

    const returnNumber = await nextDocumentNumber(tx, "PR", "purchase_returns", "returnNumber")
    const items: Prisma.PurchaseReturnItemCreateManyPurchaseReturnInput[] = []
    for (const line of lines) {
      const { item, quantity } = line
      // Stock leaves at the warehouse average (landed) cost (row locked).
      const unitCost = await averageCost(tx, item.productId, po.warehouseId)
      await decrementStock(tx, { productId: item.productId, warehouseId: po.warehouseId, quantity })
      const costValue = roundMoney(unitCost.times(quantity))
      items.push({
        purchaseOrderItemId: item.id,
        productId: item.productId,
        quantity,
        unitPrice: item.unitPrice,
        amount: line.amount,
        unitCost,
        costValue,
      })
    }
    const costValue = sumMoney(items.map((i) => i.costValue as Money))

    const created = await tx.purchaseReturn.create({
      data: {
        returnNumber,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        warehouseId: po.warehouseId,
        reason,
        notes,
        goodsAmount,
        discount,
        tax,
        creditTotal,
        costValue,
        refundAmount: refund?.amount ?? ZERO,
        refundMethod: refund?.method.paymentMethod ?? null,
        payerPhone: refund?.method.payerPhone ?? null,
        transactionId: refund?.method.transactionId ?? null,
        refundReference: refund?.reference ?? null,
        userId: user.id,
        items: { createMany: { data: items } },
      },
    })

    for (const i of items) {
      await tx.stockMovement.create({
        data: {
          productId: i.productId,
          warehouseId: po.warehouseId,
          type: "OUT",
          quantity: i.quantity,
          reference: returnNumber,
          referenceId: created.id,
          notes: `Return to supplier (${po.orderNumber}): ${reason}`.slice(0, 500),
          userId: user.id,
        },
      })
      await tx.inventoryValuationEntry.create({
        data: {
          type: "PURCHASE_RETURN",
          productId: i.productId,
          warehouseId: po.warehouseId,
          quantity: i.quantity,
          amount: i.costValue as Money,
          purchaseOrderItemId: i.purchaseOrderItemId,
          userId: user.id,
        },
      })
    }
    return created.id
  }, TX_OPTIONS)
}

export const purchaseReturnInclude = {
  supplier: { select: { id: true, name: true, phone: true, email: true, address: true } },
  warehouse: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, orderNumber: true, orderDate: true } },
  user: userSelect,
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
} satisfies Prisma.PurchaseReturnInclude

export async function purchaseReturnDetail(user: PermissionUser, id: string) {
  const row = await prisma.purchaseReturn.findUnique({ where: { id }, include: purchaseReturnInclude })
  if (!row || (isOwnScope(user, "purchase_returns") && row.userId !== user.id)) throw new HttpError(404, "Purchase return not found")
  if (!hasPermission(user, ["product_cost", "view"])) {
    return { ...row, costValue: undefined, items: row.items.map((i) => ({ ...i, unitCost: undefined, costValue: undefined })) }
  }
  return row
}

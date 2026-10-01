import type { Prisma, SalesOrderStatus } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, ZERO, parseMoney, roundMoney, sumMoney } from "@/lib/money"
import { allocateAmount } from "@/lib/landed-costs"
import { createWithOrderNumber, lastSequenceNumber, nextDocumentNumber, parseOrderItems } from "@/lib/orders"
import { assertCanReference } from "@/lib/ownership"
import type { Module } from "@/lib/permission-rules"
import { type PermissionUser, hasPermission, isOwnScope, requirePermission, salesDiscountLimit } from "@/lib/permissions"
import {
  calculateSalesTotals,
  formatPercent,
  isDiscountReasonRequired,
  parseDiscount,
  parseDiscountReason,
  reasonReferenceLimit,
} from "@/lib/sales-discounts"
import { fulfilReservedStock, releaseReservedStock, reserveStock } from "@/lib/stock"
import { averageCost, roundUnitCost } from "@/lib/stock-valuation"
import { currentTaxRate } from "@/lib/tax"
import { configuredWalkInId } from "@/lib/company"
import { parsePaymentFields } from "@/lib/payment-fields"
import type { SessionUser } from "@/lib/auth-guard"
import { postAccounting } from "@/lib/accounting"

// Sales orders with stock reservations.
//
//   DRAFT                no stock is touched; can be edited, deleted, confirmed
//   confirm              the ordered units are RESERVED (quantity unchanged,
//                        reserved += n, guarded: never more than available);
//                        reservedUntil = now + Settings salesReservationDays
//   deliver (partial)    units leave the warehouse (quantity -= n, reserved -= n)
//                        and a SalesDelivery records revenue, customer debt and
//                        COGS (warehouse average cost at delivery) for exactly
//                        the delivered share of the order
//   cancel               DRAFT / CONFIRMED: reservation released -> CANCELLED;
//                        PARTIALLY_DELIVERED: the rest is released and the
//                        order is closed as DELIVERED (short)
//   reservations         expired ones are listed (never released automatically);
//                        managers extend or release them, with a reason
//   sell & deliver now   create + confirm + deliver everything in ONE transaction
//
// Delivered share: each line's cumulative amount is subtotal x delivered /
// quantity (rounded), the order discount and tax follow the cumulative share
// of the order subtotal; every delivery is the difference, so the deliveries
// of a fully delivered order add up exactly to the order totals.

type Tx = Prisma.TransactionClient

export const SALES_STATUSES: SalesOrderStatus[] = ["DRAFT", "CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "CANCELLED"]
export const OPEN_STATUSES: SalesOrderStatus[] = ["CONFIRMED", "PARTIALLY_DELIVERED"]

export function parseSalesStatus(value: unknown): SalesOrderStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string" || !(SALES_STATUSES as string[]).includes(value)) {
    throw new HttpError(400, "Invalid sales order status")
  }
  return value as SalesOrderStatus
}

// --- Transitions and permissions ---------------------------------------------

export type SalesAction = "edit" | "delete" | "confirm" | "deliver" | "cancel" | "extend" | "release"

/** Central transition table: which actions each status allows. */
export const SALES_TRANSITIONS: Record<SalesOrderStatus, SalesAction[]> = {
  DRAFT: ["edit", "delete", "confirm", "cancel"],
  CONFIRMED: ["edit", "deliver", "cancel", "extend", "release"],
  PARTIALLY_DELIVERED: ["deliver", "cancel", "extend", "release"],
  DELIVERED: [],
  CANCELLED: [],
}

/** Permission (central system) needed for each action. */
export const SALES_ACTION_PERMISSION: Record<SalesAction, [Module, "create" | "edit" | "delete"]> = {
  edit: ["sales", "edit"],
  delete: ["sales", "delete"],
  confirm: ["sales_confirm", "create"],
  deliver: ["sales_deliver", "create"],
  cancel: ["sales_confirm", "delete"],
  extend: ["sales_reservations", "edit"],
  release: ["sales_reservations", "delete"],
}

const ACTION_LABEL: Record<SalesAction, string> = {
  edit: "edited",
  delete: "deleted",
  confirm: "confirmed",
  deliver: "delivered",
  cancel: "cancelled",
  extend: "extended",
  release: "released",
}

function assertTransition(status: SalesOrderStatus, action: SalesAction) {
  if (!SALES_TRANSITIONS[status].includes(action)) {
    throw new HttpError(400, `A ${status.replace("_", " ").toLowerCase()} order cannot be ${ACTION_LABEL[action]}`)
  }
}

/** Order visible to the user (sales scope) - 404 otherwise. */
export async function assertSalesOrderInScope(user: PermissionUser, id: string) {
  const order = await prisma.salesOrder.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!order || (isOwnScope(user, "sales") && order.userId !== user.id)) throw new HttpError(404, "Sales order not found")
  return order
}

/** Permission + scope of the action's module (OWN = only the user's own orders). */
function assertMayAct(user: PermissionUser, order: { userId: string }, action: SalesAction) {
  const [mod, act] = SALES_ACTION_PERMISSION[action]
  requirePermission(user, [mod, act])
  if ((isOwnScope(user, mod) || isOwnScope(user, "sales")) && order.userId !== user.id) {
    throw new HttpError(403, "You can only do this for your own sales orders")
  }
}

/** Actions the user may take on this order now (for the UI; the server re-checks). */
export function allowedSalesActions(user: PermissionUser, order: { userId: string; status: SalesOrderStatus }) {
  return SALES_TRANSITIONS[order.status].filter((action) => {
    const [mod, act] = SALES_ACTION_PERMISSION[action]
    if (!hasPermission(user, [mod, act])) return false
    return !((isOwnScope(user, mod) || isOwnScope(user, "sales")) && order.userId !== user.id)
  })
}

// --- Helpers -----------------------------------------------------------------------

function reasonOf(value: unknown, what: string): string {
  const reason = typeof value === "string" ? value.trim() : ""
  if (!reason) throw new HttpError(400, `A reason is required to ${what}`)
  if (reason.length > 500) throw new HttpError(400, "Reason must be at most 500 characters")
  return reason
}

const remainingOf = (i: { quantity: number; deliveredQuantity: number; releasedQuantity: number }) =>
  i.quantity - i.deliveredQuantity - i.releasedQuantity

/** Reservation period in days (Settings salesReservationDays, 1-365, default 7). */
export async function reservationDays(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: "salesReservationDays" } })
  const days = Number(row?.value)
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : 7
}

const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000)

async function lockOrder(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "sales_orders" WHERE "id" = ${id} FOR UPDATE`
  const order = await tx.salesOrder.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" } } } })
  if (!order) throw new HttpError(404, "Sales order not found")
  return order
}
type LockedOrder = Awaited<ReturnType<typeof lockOrder>>

async function addEvent(tx: Tx, e: { salesOrderId: string; type: string; userId: string; notes?: string | null; data?: unknown }) {
  await tx.salesOrderEvent.create({
    data: {
      salesOrderId: e.salesOrderId,
      type: e.type,
      userId: e.userId,
      notes: e.notes ?? null,
      data: (e.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}

// --- Input (create / edit) ---------------------------------------------------------

/** Validates the order body and calculates all totals in Decimal (client totals are ignored). */
async function parseSalesInput(user: SessionUser, body: any, taxRate: Money) {
  const { customerId, warehouseId } = body ?? {}
  if (!customerId || !warehouseId) throw new HttpError(400, "Customer, Warehouse, and at least one item are required")
  const items = parseOrderItems(body.items)
  // The walk-in customer is shared by everyone who sells (no owner check).
  const walkIn = customerId === (await configuredWalkInId())
  await assertCanReference(user, { ...(!walkIn && { customerId }), warehouseId, productIds: items.map((i) => i.productId) })

  const rawItems = body.items as { discount?: unknown }[]
  const totals = calculateSalesTotals(
    items,
    rawItems.map((raw, index) => parseDiscount(raw?.discount, `Line ${index + 1}`)),
    parseDiscount(body.discount, "Order"),
    (index) => `Line ${index + 1}`,
    taxRate
  )
  // Limits come from the sales_discount permission (Roles & Permissions).
  let discountReason: string | null = null
  if (!totals.totalDiscount.isZero()) {
    const limit = salesDiscountLimit(user) // 403 if the role may not give discounts
    if (limit !== null && totals.discountPercent.gt(limit)) {
      throw new HttpError(
        403,
        `The total discount of ${formatPercent(totals.discountPercent)}% exceeds your limit of ${limit}%. Ask a sales manager or admin to create this order.`
      )
    }
    const reference = await reasonReferenceLimit(limit)
    discountReason = parseDiscountReason(body.discountReason, isDiscountReasonRequired(totals.discountPercent, reference))
  }
  const expected = body.expectedDelivery ? new Date(body.expectedDelivery) : null
  if (expected && Number.isNaN(expected.getTime())) throw new HttpError(400, "Invalid expected delivery date")
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null

  return {
    customerId: customerId as string,
    warehouseId: warehouseId as string,
    order: {
      customerId,
      warehouseId,
      expectedDeliveryDate: expected,
      subtotal: totals.subtotal,
      tax: totals.tax,
      taxRate,
      discount: totals.discount,
      discountType: totals.discountType,
      discountValue: totals.discountValue,
      itemDiscount: totals.itemDiscount,
      discountReason,
      total: totals.total,
      notes,
    },
    items: totals.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: line.subtotal,
      discountType: line.discountType,
      discountValue: line.discountValue,
      discountAmount: line.discountAmount,
    })),
  }
}

// --- Actions (inside a transaction) --------------------------------------------------

async function reserveItems(tx: Tx, order: LockedOrder) {
  for (const item of order.items) {
    const qty = remainingOf(item)
    if (qty > 0) await reserveStock(tx, { productId: item.productId, warehouseId: order.warehouseId, quantity: qty })
  }
}

async function releaseItems(tx: Tx, order: LockedOrder, { markReleased }: { markReleased: boolean }) {
  const released: { itemId: string; productId: string; quantity: number }[] = []
  for (const item of order.items) {
    const qty = remainingOf(item)
    if (qty <= 0) continue
    await releaseReservedStock(tx, { productId: item.productId, warehouseId: order.warehouseId, quantity: qty })
    if (markReleased) await tx.salesOrderItem.update({ where: { id: item.id }, data: { releasedQuantity: { increment: qty } } })
    released.push({ itemId: item.id, productId: item.productId, quantity: qty })
  }
  return released
}

async function confirmInTx(tx: Tx, id: string, userId: string, days: number) {
  const order = await lockOrder(tx, id)
  assertTransition(order.status, "confirm")
  await reserveItems(tx, order)
  const reservedUntil = addDays(days)
  await tx.salesOrder.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date(), reservedUntil } })
  await addEvent(tx, { salesOrderId: id, type: "CONFIRMED", userId, data: { reservedUntil } })
}

interface DeliveryItem {
  id: string
  productId: string
  quantity: number
  subtotal: Money
  deliveredQuantity: number
}

interface DeliveryOrder<I extends DeliveryItem> {
  subtotal: Money
  discount: Money
  tax: Money
  items: I[]
}

const lineCumulative = (item: DeliveryItem, units: number): Money =>
  units >= item.quantity ? item.subtotal : roundMoney(item.subtotal.times(units).div(item.quantity))

const orderCumulative = (amount: Money, delivered: Money, subtotal: Money): Money =>
  subtotal.isZero() ? ZERO : delivered.gte(subtotal) ? amount : roundMoney(amount.times(delivered).div(subtotal))

/**
 * Money of one delivery: per line the delivered share of its amount, plus the
 * delivery's share of the order discount and tax (allocated to the lines by
 * amount). Pure function (unit-testable).
 */
export function computeDelivery<I extends DeliveryItem>(order: DeliveryOrder<I>, quantities: Map<string, number>) {
  let before = ZERO
  let after = ZERO
  const all = order.items.map((item) => {
    const quantity = quantities.get(item.id) ?? 0
    const b = lineCumulative(item, item.deliveredQuantity)
    const a = lineCumulative(item, item.deliveredQuantity + quantity)
    before = before.plus(b)
    after = after.plus(a)
    return { item, quantity, amount: a.minus(b) }
  })
  const lines = all.filter((l) => l.quantity > 0)
  const discount = orderCumulative(order.discount, after, order.subtotal).minus(orderCumulative(order.discount, before, order.subtotal))
  const tax = orderCumulative(order.tax, after, order.subtotal).minus(orderCumulative(order.tax, before, order.subtotal))
  const weights = lines.map((l) => l.amount)
  const discounts = lines.length ? allocateAmount(discount, weights) : []
  const taxes = lines.length ? allocateAmount(tax, weights) : []
  const subtotal = sumMoney(weights)
  return {
    lines: lines.map((l, i) => ({ ...l, discount: discounts[i], tax: taxes[i] })),
    subtotal,
    discount,
    tax,
    total: subtotal.minus(discount).plus(tax),
  }
}

/** lines: [{ itemId, quantity }] or "all" (everything still reserved). */
async function deliverInTx(tx: Tx, id: string, userId: string, requested: { itemId: string; quantity: number }[] | "all", notes: string | null) {
  const order = await lockOrder(tx, id)
  assertTransition(order.status, "deliver")

  const quantities = new Map<string, number>()
  if (requested === "all") {
    for (const item of order.items) if (remainingOf(item) > 0) quantities.set(item.id, remainingOf(item))
  } else {
    for (const line of requested) {
      const item = order.items.find((i) => i.id === line.itemId)
      if (!item) throw new HttpError(400, "Line not found on this order")
      if (!Number.isInteger(line.quantity) || line.quantity < 0) throw new HttpError(400, "Quantities must be whole numbers of 0 or more")
      if (line.quantity > remainingOf(item)) throw new HttpError(400, `Only ${remainingOf(item)} unit(s) left to deliver on a line`)
      if (line.quantity > 0) quantities.set(item.id, (quantities.get(item.id) ?? 0) + line.quantity)
    }
    for (const [itemId, qty] of quantities) {
      const item = order.items.find((i) => i.id === itemId)!
      if (qty > remainingOf(item)) throw new HttpError(400, `Only ${remainingOf(item)} unit(s) left to deliver on a line`)
    }
  }
  if (quantities.size === 0) throw new HttpError(400, "Enter at least one quantity to deliver")

  const money = computeDelivery(order, quantities)
  const deliveryNumber = await nextDocumentNumber(tx, "DN", "sales_deliveries", "deliveryNumber")
  const itemRows: Prisma.SalesDeliveryItemCreateManyDeliveryInput[] = []
  for (const line of money.lines) {
    const { item, quantity } = line
    // COGS: the warehouse average (landed) cost now (row locked).
    const unitCost = await averageCost(tx, item.productId, order.warehouseId)
    await fulfilReservedStock(tx, { productId: item.productId, warehouseId: order.warehouseId, quantity })
    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        warehouseId: order.warehouseId,
        type: "OUT",
        quantity,
        reference: order.orderNumber,
        referenceId: order.id,
        notes: `Delivery ${deliveryNumber} of sales order ${order.orderNumber}`,
        userId,
      },
    })
    const cogs = roundMoney(unitCost.times(quantity))
    const delivered = item.deliveredQuantity + quantity
    await tx.salesOrderItem.update({
      where: { id: item.id },
      data: {
        deliveredQuantity: delivered,
        unitCost: roundUnitCost(item.unitCost.times(item.deliveredQuantity).plus(unitCost.times(quantity)).div(delivered)),
      },
    })
    itemRows.push({
      salesOrderItemId: item.id,
      productId: item.productId,
      quantity,
      amount: line.amount,
      discount: line.discount,
      tax: line.tax,
      unitCost,
      cogs,
    })
  }

  const delivery = await tx.salesDelivery.create({
    data: {
      deliveryNumber,
      salesOrderId: order.id,
      subtotal: money.subtotal,
      discount: money.discount,
      tax: money.tax,
      total: money.total,
      cogs: sumMoney(itemRows.map((r) => r.cogs as Money)),
      notes,
      userId,
      items: { createMany: { data: itemRows } },
    },
  })

  const done = order.items.every((i) => remainingOf(i) - (quantities.get(i.id) ?? 0) === 0)
  await tx.salesOrder.update({
    where: { id: order.id },
    data: done
      ? { status: "DELIVERED", deliveredAt: new Date(), reservedUntil: null }
      : { status: "PARTIALLY_DELIVERED" },
  })
  await addEvent(tx, {
    salesOrderId: order.id,
    type: done ? "DELIVERED" : "PARTIALLY_DELIVERED",
    userId,
    notes,
    data: { deliveryNumber, total: money.total.toFixed(2), lines: itemRows.map((r) => ({ itemId: r.salesOrderItemId, quantity: r.quantity })) },
  })
  return delivery
}

/** Releases what is still reserved and closes the order (cancel / reservation release). */
async function closeRemainingInTx(tx: Tx, id: string, userId: string, reason: string, action: "cancel" | "release") {
  const order = await lockOrder(tx, id)
  assertTransition(order.status, action)
  const delivered = order.items.some((i) => i.deliveredQuantity > 0)
  const released = order.status === "DRAFT" ? [] : await releaseItems(tx, order, { markReleased: true })
  if (order.status === "DRAFT") {
    for (const item of order.items) await tx.salesOrderItem.update({ where: { id: item.id }, data: { releasedQuantity: item.quantity } })
  }
  const closeAsDelivered = delivered
  await tx.salesOrder.update({
    where: { id },
    data: closeAsDelivered
      ? { status: "DELIVERED", deliveredAt: new Date(), reservedUntil: null, cancelReason: reason }
      : { status: "CANCELLED", cancelledAt: new Date(), reservedUntil: null, cancelReason: reason },
  })
  await addEvent(tx, {
    salesOrderId: id,
    type: action === "release" ? "RESERVATION_RELEASED" : closeAsDelivered ? "CLOSED" : "CANCELLED",
    userId,
    notes: reason,
    data: { released, from: order.status },
  })
}

// --- Public API (each runs in one transaction) ------------------------------------

export type CreateMode = "draft" | "confirm" | "sell_now"

export async function createSalesOrder(user: SessionUser, body: any): Promise<string> {
  const mode: CreateMode = body?.mode === "confirm" || body?.mode === "sell_now" ? body.mode : "draft"
  if (body?.mode !== undefined && !["draft", "confirm", "sell_now"].includes(body.mode)) {
    throw new HttpError(400, "mode must be draft, confirm or sell_now")
  }
  if (mode !== "draft") requirePermission(user, SALES_ACTION_PERMISSION.confirm, "You are not allowed to confirm sales orders")
  if (mode === "sell_now") requirePermission(user, SALES_ACTION_PERMISSION.deliver, "You are not allowed to deliver sales orders")

  const taxRate = await currentTaxRate("sales")
  const input = await parseSalesInput(user, body, taxRate)
  const days = await reservationDays()

  // "Paid now" (sell & deliver now only): a customer payment in the same transaction.
  const walkIn = input.customerId === (await configuredWalkInId())
  let payment: { amount: Money; method: Awaited<ReturnType<typeof parsePaymentFields>>; reference: string | null } | null = null
  if (body?.payment) {
    if (mode !== "sell_now") throw new HttpError(400, "A payment can only be recorded with \"Sell & deliver now\"")
    requirePermission(user, ["customer_payments", "create"], "You are not allowed to record customer payments")
    const amount = parseMoney(body.payment.amount, { field: "Amount paid" })
    if (amount.gt(input.order.total)) throw new HttpError(400, `The amount paid cannot be more than the total of ${input.order.total.toFixed(2)}`)
    const reference = typeof body.payment.reference === "string" && body.payment.reference.trim() ? body.payment.reference.trim().slice(0, 100) : null
    payment = { amount, method: await parsePaymentFields(body.payment), reference }
  }
  // Walk-in (anonymous) sales are cash sales: delivered and fully paid at once.
  if (walkIn) {
    if (mode !== "sell_now") throw new HttpError(400, "The walk-in customer can only buy with \"Sell & deliver now\"; choose a named customer for orders on credit")
    if (!payment || !payment.amount.eq(input.order.total)) {
      throw new HttpError(400, `A walk-in sale must be paid in full (${input.order.total.toFixed(2)}); for credit choose a named customer`)
    }
  }

  return createWithOrderNumber(
    "SO",
    // Drafts can be deleted, so the next number follows the highest one (not the count).
    () => lastSequenceNumber("sales_orders", "orderNumber"),
    (orderNumber) =>
      prisma.$transaction(async (tx) => {
        const order = await tx.salesOrder.create({
          data: { ...input.order, orderNumber, userId: user.id, status: "DRAFT", items: { create: input.items } },
        })
        await addEvent(tx, { salesOrderId: order.id, type: "CREATED", userId: user.id, data: { total: input.order.total.toFixed(2) } })
        if (mode !== "draft") await confirmInTx(tx, order.id, user.id, days)
        if (mode === "sell_now") {
          await deliverInTx(tx, order.id, user.id, "all", "Sell & deliver now")
          if (payment) {
            await tx.customerPayment.create({
              data: {
                customerId: input.customerId,
                salesOrderId: order.id,
                amount: payment.amount,
                paymentMethod: payment.method.paymentMethod,
                payerPhone: payment.method.payerPhone,
                transactionId: payment.method.transactionId,
                reference: payment.reference ?? orderNumber,
                notes: "Paid at sale",
                userId: user.id,
              },
            })
          }
          await postAccounting(tx, {}, user.id)
        }
        return order.id
      }, TX_OPTIONS)
  )
}

async function loadForAction(user: PermissionUser, id: string, action: SalesAction) {
  const order = await prisma.salesOrder.findUnique({ where: { id }, select: { id: true, userId: true, status: true } })
  if (!order || (isOwnScope(user, "sales") && order.userId !== user.id)) throw new HttpError(404, "Sales order not found")
  assertMayAct(user, order, action)
  assertTransition(order.status, action)
  return order
}

/** Edit a DRAFT, or a CONFIRMED order before any delivery (its reservation is adjusted). */
export async function editSalesOrder(user: SessionUser, id: string, body: any) {
  await loadForAction(user, id, "edit")
  const current = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, select: { taxRate: true } })
  // The tax rate stored on the order is kept (never the current Settings).
  const input = await parseSalesInput(user, body, current.taxRate)
  if (input.customerId === (await configuredWalkInId())) {
    throw new HttpError(400, "The walk-in customer can only buy with \"Sell & deliver now\"; choose a named customer")
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, id)
    assertTransition(order.status, "edit")
    if (order.status === "CONFIRMED") await releaseItems(tx, order, { markReleased: false })
    await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } })
    await tx.salesOrder.update({ where: { id }, data: { ...input.order, items: { create: input.items } } })
    if (order.status === "CONFIRMED") await reserveItems(tx, await lockOrder(tx, id))
    await addEvent(tx, {
      salesOrderId: id,
      type: "EDITED",
      userId: user.id,
      data: { before: order.total.toFixed(2), after: input.order.total.toFixed(2) },
    })
  }, TX_OPTIONS)
}

export async function deleteDraftSalesOrder(user: SessionUser, id: string) {
  await loadForAction(user, id, "delete")
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, id)
    assertTransition(order.status, "delete")
    if (await tx.customerPayment.count({ where: { salesOrderId: id } })) {
      throw new HttpError(409, "Payments are linked to this draft; cancel it instead")
    }
    await tx.salesOrder.delete({ where: { id } })
  }, TX_OPTIONS)
}

export async function confirmSalesOrder(user: SessionUser, id: string) {
  await loadForAction(user, id, "confirm")
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, select: { customerId: true } })
  if (order.customerId === (await configuredWalkInId())) {
    throw new HttpError(400, "A walk-in sale cannot be put on credit; change the customer to a named one first")
  }
  const days = await reservationDays()
  await prisma.$transaction((tx) => confirmInTx(tx, id, user.id, days), TX_OPTIONS)
}

export async function deliverSalesOrder(user: SessionUser, id: string, body: any) {
  await loadForAction(user, id, "deliver")
  const lines = body?.lines === "all" || body?.lines === undefined ? "all" : body.lines
  if (lines !== "all" && !Array.isArray(lines)) throw new HttpError(400, "lines must be a list or \"all\"")
  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null
  const parsed =
    lines === "all"
      ? "all"
      : (lines as any[]).map((l) => ({ itemId: String(l?.itemId ?? ""), quantity: Number(l?.quantity ?? 0) }))
  return prisma.$transaction(async (tx) => {
    const delivery = await deliverInTx(tx, id, user.id, parsed, notes)
    await postAccounting(tx, {}, user.id)
    return delivery
  }, TX_OPTIONS)
}

export async function cancelSalesOrder(user: SessionUser, id: string, body: any) {
  await loadForAction(user, id, "cancel")
  const reason = reasonOf(body?.reason, "cancel the order")
  await prisma.$transaction((tx) => closeRemainingInTx(tx, id, user.id, reason, "cancel"), TX_OPTIONS)
}

export async function releaseReservation(user: SessionUser, id: string, body: any) {
  await loadForAction(user, id, "release")
  const reason = reasonOf(body?.reason, "release the reservation")
  await prisma.$transaction((tx) => closeRemainingInTx(tx, id, user.id, reason, "release"), TX_OPTIONS)
}

export async function extendReservation(user: SessionUser, id: string, body: any) {
  await loadForAction(user, id, "extend")
  const reason = reasonOf(body?.reason, "extend the reservation")
  const until = new Date(body?.until)
  if (Number.isNaN(until.getTime())) throw new HttpError(400, "A valid new reservation date is required")
  if (until.getTime() <= Date.now()) throw new HttpError(400, "The new reservation date must be in the future")
  if (until.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) throw new HttpError(400, "A reservation can be extended by at most one year")
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, id)
    assertTransition(order.status, "extend")
    await tx.salesOrder.update({ where: { id }, data: { reservedUntil: until } })
    await addEvent(tx, { salesOrderId: id, type: "RESERVATION_EXTENDED", userId: user.id, notes: reason, data: { from: order.reservedUntil, to: until } })
  }, TX_OPTIONS)
}

// --- Reads ---------------------------------------------------------------------------

const userSelect = { select: { id: true, name: true, username: true } } as const

export const salesOrderInclude = {
  customer: true,
  warehouse: true,
  user: userSelect,
  items: { orderBy: { id: "asc" }, include: { product: true } },
} satisfies Prisma.SalesOrderInclude

export async function salesOrderDetail(user: PermissionUser, id: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({
    where: { id },
    include: {
      ...salesOrderInclude,
      deliveries: { orderBy: { deliveredAt: "asc" }, include: { user: userSelect, items: true } },
      events: { orderBy: { createdAt: "asc" }, include: { user: userSelect } },
      customerPayments: { orderBy: { paymentDate: "asc" } },
      returns: { orderBy: { returnDate: "asc" }, select: { id: true, returnNumber: true, returnDate: true, total: true, refundAmount: true, reason: true } },
    },
  })
  return {
    ...order,
    items: order.items.map((i) => ({ ...i, remainingQuantity: remainingOf(i) })),
    deliveredTotal: sumMoney(order.deliveries.map((d) => d.total)),
    returnedTotal: sumMoney(order.returns.map((r) => r.total)),
    reservationExpired: !!order.reservedUntil && OPEN_STATUSES.includes(order.status) && order.reservedUntil.getTime() < Date.now(),
    allowedActions: allowedSalesActions(user, order),
  }
}

/** Open reservations (CONFIRMED / PARTIALLY_DELIVERED), optionally only expired ones. */
export async function listReservations(user: PermissionUser, { expiredOnly }: { expiredOnly: boolean }) {
  const own = isOwnScope(user, "sales_reservations") || isOwnScope(user, "sales") ? { userId: user.id } : {}
  const orders = await prisma.salesOrder.findMany({
    where: {
      ...own,
      status: { in: OPEN_STATUSES },
      ...(expiredOnly && { reservedUntil: { lt: new Date() } }),
    },
    include: { customer: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } }, user: userSelect, items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
    orderBy: { reservedUntil: "asc" },
    take: 500,
  })
  return orders.map((o) => ({
    ...o,
    reservedUnits: o.items.reduce((sum, i) => sum + remainingOf(i), 0),
    reservationExpired: !!o.reservedUntil && o.reservedUntil.getTime() < Date.now(),
    allowedActions: allowedSalesActions(user, o),
  }))
}


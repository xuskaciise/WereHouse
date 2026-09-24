import type { Prisma, TransferStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, parseMoney, roundMoney, sumMoney } from "@/lib/money"
import { allocateAmount } from "@/lib/landed-costs"
import { applyLandedCostDelta, averageCost, dispatchFromStock, receiveIntoStock } from "@/lib/stock-valuation"
import { parseQuantity } from "@/lib/stock"
import { type PermissionUser, scopeWhere } from "@/lib/permissions"

// Warehouse-to-warehouse stock transfers.
//
//   DRAFT        planned; no stock change, nothing reserved (availability is
//                checked at dispatch; the draft shows a warning)
//   dispatch     stock leaves the source (guarded, never negative) at the
//                source average cost -> the goods are IN_TRANSIT
//   receive      per line: received units enter the destination at their
//                dispatch cost + their share of the transfer costs (the
//                destination average is re-weighted); lost / damaged units
//                need a reason and are booked as TRANSFER_LOSS
//   close        the rest of a PARTIALLY_RECEIVED line is returned to the
//                source (at dispatch cost) or written off as a loss
//   cancel       DRAFT, or IN_TRANSIT (goods return to the source at their
//                dispatch cost)
// Goods in transit are counted in neither warehouse but in the in-transit
// value, so the total stock value never double-counts or loses them.
//
// Transfer costs (e.g. transport) are allocated by value; the share of the
// received units is added to the destination landed cost, the share of
// lost / returned units is booked as a loss. Changes after receipt revalue
// the destination like purchase landed costs (stock / COGS split).

type Tx = Prisma.TransactionClient
const OPEN: TransferStatus[] = ["IN_TRANSIT", "PARTIALLY_RECEIVED"]

export const transferInclude = {
  fromWarehouse: { select: { id: true, name: true, code: true } },
  toWarehouse: { select: { id: true, name: true, code: true } },
  user: { select: { id: true, name: true, username: true } },
  items: { orderBy: { createdAt: "asc" }, include: { product: { select: { id: true, name: true, sku: true } } } },
  receipts: {
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, username: true } }, items: true },
  },
  events: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, username: true } } } },
  costs: {
    orderBy: { createdAt: "asc" },
    include: {
      type: { select: { id: true, name: true } },
      paidToSupplier: { select: { id: true, name: true, type: true } },
      supplierPayments: { select: { id: true, amount: true } },
    },
  },
} satisfies Prisma.StockTransferInclude

type Item = { dispatchedQuantity: number; receivedQuantity: number; lostQuantity: number; returnedQuantity: number }
export const inTransitOf = (i: Item) => i.dispatchedQuantity - i.receivedQuantity - i.lostQuantity - i.returnedQuantity

/** Share of `amount` that belongs to `units` of `total` units, to the cent. */
function share(amount: Money, units: number, total: number): Money {
  if (units <= 0 || total <= 0) return ZERO
  if (units >= total) return amount
  return roundMoney(amount.times(units).div(total))
}

export async function lockTransfer(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "stock_transfers" WHERE "id" = ${id} FOR UPDATE`
  return tx.stockTransfer.findUniqueOrThrow({ where: { id }, include: { items: true, costs: true } })
}
type Locked = Awaited<ReturnType<typeof lockTransfer>>

export async function addEvent(
  tx: Tx,
  e: { stockTransferId: string; type: string; userId: string; notes?: string | null; data?: unknown }
) {
  await tx.stockTransferEvent.create({
    data: {
      stockTransferId: e.stockTransferId,
      type: e.type,
      userId: e.userId,
      notes: e.notes ?? null,
      data: (e.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}

function reasonOf(value: unknown, what: string): string {
  const reason = typeof value === "string" ? value.trim() : ""
  if (!reason) throw new HttpError(400, `A reason is required for ${what}`)
  if (reason.length > 500) throw new HttpError(400, "Reason must be at most 500 characters")
  return reason
}

function wholeNumber(value: unknown, field: string): number {
  const n = value === undefined || value === null || value === "" ? 0 : Number(value)
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${field} must be a whole number of 0 or more`)
  return n
}

// --- Transfer costs --------------------------------------------------------------

/**
 * Re-allocates the transfer costs by value (dispatched quantity x dispatch
 * cost; for drafts planned quantity x current source average) and brings the
 * applied parts in line: received units -> destination stock (stock / COGS
 * split), lost + returned units -> loss.
 */
export async function syncTransferCosts(tx: Tx, stockTransferId: string, userId: string) {
  const t = await tx.stockTransfer.findUniqueOrThrow({ where: { id: stockTransferId }, include: { items: true, costs: true } })
  const total = sumMoney(t.costs.map((c) => c.amount))
  const weights: Money[] = []
  for (const item of t.items) {
    if (item.dispatchedQuantity > 0) weights.push(item.unitCost.times(item.dispatchedQuantity))
    else weights.push((await averageCost(tx, item.productId, t.fromWarehouseId)).times(item.quantity))
  }
  const byValue = sumMoney(weights).isZero() ? t.items.map((i) => new Decimal(i.quantity)) : weights
  const allocations = allocateAmount(total, byValue)

  for (const [index, item] of t.items.entries()) {
    const allocated = allocations[index]
    const dispatched = item.dispatchedQuantity
    const appliedTarget = share(allocated, item.receivedQuantity, dispatched)
    const lossTarget = share(allocated, item.receivedQuantity + item.lostQuantity + item.returnedQuantity, dispatched).minus(appliedTarget)
    const dApplied = appliedTarget.minus(item.appliedCost)
    const dLoss = lossTarget.minus(item.lossCost)
    if (!dApplied.isZero()) {
      await applyLandedCostDelta(tx, {
        productId: item.productId,
        warehouseId: t.toWarehouseId,
        receivedUnits: item.receivedQuantity,
        delta: dApplied,
        userId,
        stockTransferItemId: item.id,
      })
    }
    if (!dLoss.isZero()) {
      await tx.inventoryValuationEntry.create({
        data: {
          type: "TRANSFER_LOSS",
          productId: item.productId,
          warehouseId: t.toWarehouseId,
          quantity: 0,
          amount: dLoss,
          stockTransferItemId: item.id,
          userId,
        },
      })
    }
    if (!allocated.equals(item.allocatedCost) || !dApplied.isZero() || !dLoss.isZero()) {
      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { allocatedCost: allocated, appliedCost: appliedTarget, lossCost: lossTarget },
      })
    }
  }
}

/**
 * Transfer costs can be changed until the transfer is fully RECEIVED (or
 * closed); afterwards only ADMIN, with a reason. Never on a cancelled one.
 */
export function assertTransferCostsEditable(user: { role: string }, t: { status: TransferStatus }, rawReason: unknown) {
  if (t.status === "CANCELLED") throw new HttpError(400, "The transfer is cancelled")
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 500) : null
  if (t.status !== "RECEIVED") return reason
  if (user.role !== "ADMIN") throw new HttpError(403, "The transfer is completed; only an admin can change its costs")
  if (!reason) throw new HttpError(400, "A reason is required to change the costs of a completed transfer")
  return reason
}

// --- Actions -------------------------------------------------------------------------

async function movement(tx: Tx, t: Locked, input: { productId: string; warehouseId: string; type: "IN" | "OUT"; quantity: number; notes: string; userId: string }) {
  await tx.stockMovement.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: input.quantity,
      reference: t.transferNumber,
      referenceId: t.id,
      notes: input.notes,
      userId: input.userId,
    },
  })
}

async function names(tx: Tx, t: Locked) {
  const [from, to] = await Promise.all([
    tx.warehouse.findUniqueOrThrow({ where: { id: t.fromWarehouseId }, select: { name: true } }),
    tx.warehouse.findUniqueOrThrow({ where: { id: t.toWarehouseId }, select: { name: true } }),
  ])
  return { from: from.name, to: to.name }
}

export async function dispatchTransfer(tx: Tx, stockTransferId: string, userId: string) {
  const t = await lockTransfer(tx, stockTransferId)
  if (t.status !== "DRAFT") throw new HttpError(400, "Only a draft transfer can be dispatched")
  const wh = await names(tx, t)
  for (const item of t.items) {
    // Guarded decrement: fails the whole dispatch if not enough available stock.
    const { unitCost } = await dispatchFromStock(tx, {
      productId: item.productId,
      warehouseId: t.fromWarehouseId,
      quantity: item.quantity,
      userId,
      stockTransferItemId: item.id,
    })
    await tx.stockTransferItem.update({
      where: { id: item.id },
      data: { dispatchedQuantity: item.quantity, unitCost },
    })
    await movement(tx, t, {
      productId: item.productId,
      warehouseId: t.fromWarehouseId,
      type: "OUT",
      quantity: item.quantity,
      notes: `Transfer ${t.transferNumber} to ${wh.to} (in transit)`,
      userId,
    })
  }
  await tx.stockTransfer.update({
    where: { id: t.id },
    data: { status: "IN_TRANSIT", dispatchedAt: new Date(), dispatchedById: userId },
  })
  await syncTransferCosts(tx, t.id, userId)
  await addEvent(tx, { stockTransferId: t.id, type: "DISPATCHED", userId, data: { items: t.items.length } })
}

export interface ReceiveLine {
  itemId: string
  received: number
  lost: number
  reason: string | null
}

export function parseReceiveLines(raw: unknown): ReceiveLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "lines are required")
  const seen = new Set<string>()
  return raw.map((row: any) => {
    if (typeof row?.itemId !== "string") throw new HttpError(400, "Each line needs an itemId")
    if (seen.has(row.itemId)) throw new HttpError(400, "Each item may appear only once")
    seen.add(row.itemId)
    const received = wholeNumber(row.received, "Received quantity")
    const lost = wholeNumber(row.lost, "Damaged / lost quantity")
    return { itemId: row.itemId, received, lost, reason: lost > 0 ? reasonOf(row.reason, "damaged / lost units") : null }
  })
}

async function refreshStatus(tx: Tx, stockTransferId: string) {
  const items = await tx.stockTransferItem.findMany({ where: { stockTransferId } })
  const done = items.every((i) => inTransitOf(i) === 0)
  await tx.stockTransfer.update({
    where: { id: stockTransferId },
    data: done ? { status: "RECEIVED", receivedAt: new Date() } : { status: "PARTIALLY_RECEIVED" },
  })
  return done
}

export async function receiveTransfer(tx: Tx, stockTransferId: string, userId: string, lines: ReceiveLine[], notes: string | null) {
  const t = await lockTransfer(tx, stockTransferId)
  if (!OPEN.includes(t.status)) throw new HttpError(400, "Only a dispatched transfer can be received")
  const byId = new Map(t.items.map((i) => [i.id, i]))
  const work = lines.filter((l) => l.received > 0 || l.lost > 0)
  if (work.length === 0) throw new HttpError(400, "Enter a received or damaged / lost quantity")
  for (const line of work) {
    const item = byId.get(line.itemId)
    if (!item) throw new HttpError(400, "Invalid transfer item")
    if (line.received + line.lost > inTransitOf(item)) {
      throw new HttpError(400, `Only ${inTransitOf(item)} unit(s) of this line are still in transit`)
    }
  }

  // Bring earlier receipts in line with the current costs first.
  await syncTransferCosts(tx, t.id, userId)
  const wh = await names(tx, t)
  await tx.stockTransferReceipt.create({
    data: {
      stockTransferId: t.id,
      type: "RECEIVE",
      notes,
      userId,
      items: {
        create: work.map((l) => ({ stockTransferItemId: l.itemId, receivedQuantity: l.received, lostQuantity: l.lost, reason: l.reason })),
      },
    },
  })

  for (const line of work) {
    const item = await tx.stockTransferItem.findUniqueOrThrow({ where: { id: line.itemId } })
    const received = item.receivedQuantity + line.received
    const lost = item.lostQuantity + line.lost
    const appliedTarget = share(item.allocatedCost, received, item.dispatchedQuantity)
    const lossTarget = share(item.allocatedCost, received + lost + item.returnedQuantity, item.dispatchedQuantity).minus(appliedTarget)

    if (line.received > 0) {
      const value = roundMoney(item.unitCost.times(line.received)).plus(appliedTarget.minus(item.appliedCost))
      await receiveIntoStock(tx, {
        productId: item.productId,
        warehouseId: t.toWarehouseId,
        quantity: line.received,
        value,
        userId,
        entryType: "TRANSFER_IN",
        stockTransferItemId: item.id,
      })
      await movement(tx, t, {
        productId: item.productId,
        warehouseId: t.toWarehouseId,
        type: "IN",
        quantity: line.received,
        notes: `Transfer ${t.transferNumber} from ${wh.from}`,
        userId,
      })
    }
    if (line.lost > 0) {
      await tx.inventoryValuationEntry.create({
        data: {
          type: "TRANSFER_LOSS",
          productId: item.productId,
          warehouseId: t.toWarehouseId,
          quantity: line.lost,
          amount: roundMoney(item.unitCost.times(line.lost)).plus(lossTarget.minus(item.lossCost)),
          stockTransferItemId: item.id,
          userId,
        },
      })
    }
    await tx.stockTransferItem.update({
      where: { id: item.id },
      data: { receivedQuantity: received, lostQuantity: lost, appliedCost: appliedTarget, lossCost: lossTarget },
    })
  }

  const done = await refreshStatus(tx, t.id)
  await addEvent(tx, {
    stockTransferId: t.id,
    type: done ? "RECEIVED" : "PARTIALLY_RECEIVED",
    userId,
    notes,
    data: {
      received: work.reduce((s, l) => s + l.received, 0),
      lost: work.reduce((s, l) => s + l.lost, 0),
      reasons: work.filter((l) => l.reason).map((l) => l.reason),
    },
  })
}

export interface CloseLine {
  itemId: string
  action: "RETURN" | "WRITE_OFF"
  reason: string
}

export function parseCloseLines(raw: unknown): CloseLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "lines are required")
  return raw.map((row: any) => {
    if (typeof row?.itemId !== "string") throw new HttpError(400, "Each line needs an itemId")
    if (row.action !== "RETURN" && row.action !== "WRITE_OFF") throw new HttpError(400, "action must be RETURN or WRITE_OFF")
    return {
      itemId: row.itemId,
      action: row.action,
      reason: reasonOf(row.reason, row.action === "RETURN" ? "returning goods to the source" : "writing goods off"),
    }
  })
}

/** Closes the rest of PARTIALLY_RECEIVED lines: back to the source, or written off as a loss. */
export async function closeRemaining(tx: Tx, stockTransferId: string, userId: string, lines: CloseLine[], notes: string | null) {
  const t = await lockTransfer(tx, stockTransferId)
  if (t.status !== "PARTIALLY_RECEIVED") {
    throw new HttpError(400, "Only a partially received transfer can be closed (cancel an undelivered one instead)")
  }
  const byId = new Map(t.items.map((i) => [i.id, i]))
  for (const line of lines) {
    const item = byId.get(line.itemId)
    if (!item) throw new HttpError(400, "Invalid transfer item")
    if (inTransitOf(item) === 0) throw new HttpError(400, "Nothing left in transit on this line")
  }
  await syncTransferCosts(tx, t.id, userId)
  const wh = await names(tx, t)
  await tx.stockTransferReceipt.create({
    data: {
      stockTransferId: t.id,
      type: "CLOSE",
      notes,
      userId,
      items: {
        create: lines.map((l) => {
          const rest = inTransitOf(byId.get(l.itemId)!)
          return {
            stockTransferItemId: l.itemId,
            ...(l.action === "RETURN" ? { returnedQuantity: rest } : { lostQuantity: rest }),
            reason: l.reason,
          }
        }),
      },
    },
  })
  for (const line of lines) {
    await closeLine(tx, t, line.itemId, line.action, userId, wh.from)
  }
  await refreshStatus(tx, t.id)
  await addEvent(tx, {
    stockTransferId: t.id,
    type: "CLOSED",
    userId,
    notes,
    data: { lines: lines.map((l) => ({ itemId: l.itemId, action: l.action, reason: l.reason })) },
  })
}

async function closeLine(tx: Tx, t: Locked, itemId: string, action: "RETURN" | "WRITE_OFF", userId: string, fromName: string) {
  const item = await tx.stockTransferItem.findUniqueOrThrow({ where: { id: itemId } })
  const rest = inTransitOf(item)
  if (rest <= 0) return
  const lost = item.lostQuantity + (action === "WRITE_OFF" ? rest : 0)
  const returned = item.returnedQuantity + (action === "RETURN" ? rest : 0)
  const lossTarget = share(item.allocatedCost, item.receivedQuantity + lost + returned, item.dispatchedQuantity).minus(item.appliedCost)
  const costShare = lossTarget.minus(item.lossCost)
  const goodsValue = roundMoney(item.unitCost.times(rest))

  if (action === "RETURN") {
    // Back to the source at the dispatch cost; the transport cost of these
    // units is lost (booked as loss).
    await receiveIntoStock(tx, {
      productId: item.productId,
      warehouseId: t.fromWarehouseId,
      quantity: rest,
      value: goodsValue,
      userId,
      entryType: "TRANSFER_RETURN",
      stockTransferItemId: item.id,
    })
    await movement(tx, t, {
      productId: item.productId,
      warehouseId: t.fromWarehouseId,
      type: "IN",
      quantity: rest,
      notes: `Transfer ${t.transferNumber} returned to ${fromName}`,
      userId,
    })
  }
  const lossAmount = action === "WRITE_OFF" ? goodsValue.plus(costShare) : costShare
  if (!lossAmount.isZero()) {
    await tx.inventoryValuationEntry.create({
      data: {
        type: "TRANSFER_LOSS",
        productId: item.productId,
        warehouseId: t.toWarehouseId,
        quantity: action === "WRITE_OFF" ? rest : 0,
        amount: lossAmount,
        stockTransferItemId: item.id,
        userId,
      },
    })
  }
  await tx.stockTransferItem.update({
    where: { id: item.id },
    data: { lostQuantity: lost, returnedQuantity: returned, lossCost: lossTarget },
  })
}

/** DRAFT: nothing to undo. IN_TRANSIT: every unit returns to the source at its dispatch cost. */
export async function cancelTransfer(tx: Tx, stockTransferId: string, userId: string, rawReason: unknown) {
  const reason = reasonOf(rawReason, "cancelling a transfer")
  const t = await lockTransfer(tx, stockTransferId)
  if (t.status !== "DRAFT" && t.status !== "IN_TRANSIT") {
    throw new HttpError(400, "Only a draft or an in-transit transfer (nothing received yet) can be cancelled")
  }
  if (t.status === "DRAFT" && t.costs.length > 0) {
    throw new HttpError(409, "Delete the transfer costs of this draft first")
  }
  if (t.status === "IN_TRANSIT") {
    await syncTransferCosts(tx, t.id, userId)
    const wh = await names(tx, t)
    for (const item of t.items) await closeLine(tx, t, item.id, "RETURN", userId, wh.from)
  }
  await tx.stockTransfer.update({
    where: { id: t.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: userId, cancelReason: reason },
  })
  await addEvent(tx, { stockTransferId: t.id, type: "CANCELLED", userId, notes: reason, data: { from: t.status } })
}

// --- Reads ---------------------------------------------------------------------------

/** Available (quantity - reserved) in the source per product, for drafts. */
export async function sourceAvailability(fromWarehouseId: string, productIds: string[]) {
  const stock = await prisma.stock.findMany({
    where: { warehouseId: fromWarehouseId, productId: { in: productIds } },
    select: { productId: true, quantity: true, reservedQuantity: true },
  })
  return new Map(stock.map((s) => [s.productId, s.quantity - s.reservedQuantity]))
}

/** Goods in transit (dispatched, not yet received / lost / returned), with value. */
export async function inTransitStock(userScope: { userId?: string }) {
  const owner = userScope.userId ? { userId: userScope.userId } : {}
  const items = await prisma.stockTransferItem.findMany({
    where: { stockTransfer: { status: { in: OPEN }, ...owner } },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      stockTransfer: {
        select: {
          id: true,
          transferNumber: true,
          dispatchedAt: true,
          expectedDate: true,
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
        },
      },
    },
  })
  const rows = items
    .map((i) => ({ ...i, inTransitQuantity: inTransitOf(i), inTransitValue: roundMoney(i.unitCost.times(inTransitOf(i))) }))
    .filter((r) => r.inTransitQuantity > 0)
  return { rows, totalQuantity: rows.reduce((s, r) => s + r.inTransitQuantity, 0), inTransitValue: sumMoney(rows.map((r) => r.inTransitValue)) }
}

// --- Input -----------------------------------------------------------------------------

function parseItems(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "Add at least one item")
  const seen = new Set<string>()
  return raw.map((row: any) => {
    if (typeof row?.productId !== "string" || !row.productId) throw new HttpError(400, "Each item needs a product")
    if (seen.has(row.productId)) throw new HttpError(400, "Each product may appear only once")
    seen.add(row.productId)
    return { productId: row.productId, quantity: parseQuantity(row.quantity) }
  })
}

export function parseTransferInput(body: any) {
  const { fromWarehouseId, toWarehouseId } = body ?? {}
  if (typeof fromWarehouseId !== "string" || typeof toWarehouseId !== "string" || !fromWarehouseId || !toWarehouseId) {
    throw new HttpError(400, "Source and destination warehouse are required")
  }
  if (fromWarehouseId === toWarehouseId) throw new HttpError(400, "Source and destination warehouse must differ")
  let expectedDate: Date | null = null
  if (body.expectedDate) {
    expectedDate = new Date(body.expectedDate)
    if (Number.isNaN(expectedDate.getTime())) throw new HttpError(400, "Invalid expected date")
  }
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null
  return { fromWarehouseId, toWarehouseId, expectedDate, notes, items: parseItems(body.items) }
}

/** 404 unless the transfer exists and is within the user's stock_transfers scope. */
export async function assertTransferInScope(user: PermissionUser, id: string) {
  const found = await prisma.stockTransfer.count({ where: { id, ...scopeWhere(user, "stock_transfers") } })
  if (!found) throw new HttpError(404, "Transfer not found")
}

/** Detail for the transfer page; drafts include the current availability warning. */
export async function transferDetail(id: string) {
  const t = await prisma.stockTransfer.findUniqueOrThrow({ where: { id }, include: transferInclude })
  const available =
    t.status === "DRAFT" ? await sourceAvailability(t.fromWarehouseId, t.items.map((i) => i.productId)) : null
  const people = await prisma.user.findMany({
    where: { id: { in: [t.dispatchedById, t.cancelledById].filter((x): x is string => !!x) } },
    select: { id: true, username: true, name: true },
  })
  const person = (uid: string | null) => people.find((p) => p.id === uid) ?? null
  const items = t.items.map((item) => {
    const avail = available?.get(item.productId) ?? 0
    return {
      ...item,
      inTransitQuantity: inTransitOf(item),
      inTransitValue: roundMoney(item.unitCost.times(inTransitOf(item))),
      ...(available && { available: avail, insufficient: avail < item.quantity }),
    }
  })
  return {
    ...t,
    items,
    dispatchedBy: person(t.dispatchedById),
    cancelledBy: person(t.cancelledById),
    costs: t.costs.map((c) => {
      const paid = sumMoney(c.supplierPayments.map((p) => p.amount))
      return { ...c, paidAmount: paid, paymentStatus: paid.isZero() ? "UNPAID" : paid.gte(c.amount) ? "PAID" : "PARTLY_PAID" }
    }),
    totalCosts: sumMoney(t.costs.map((c) => c.amount)),
    draftWarning: available ? items.some((i) => i.insufficient) : false,
  }
}

// --- Transfer cost input / snapshot -------------------------------------------------------

export function parseTransferCostInput(body: any) {
  if (typeof body?.typeId !== "string" || !body.typeId) throw new HttpError(400, "Cost type is required")
  if (typeof body.paidToSupplierId !== "string" || !body.paidToSupplierId) throw new HttpError(400, "Paid-to party is required")
  const amount = parseMoney(body.amount, { field: "Amount" })
  let costDate = new Date()
  if (body.costDate) {
    costDate = new Date(body.costDate)
    if (Number.isNaN(costDate.getTime())) throw new HttpError(400, "Invalid date")
  }
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)
  return {
    typeId: body.typeId as string,
    paidToSupplierId: body.paidToSupplierId as string,
    amount,
    costDate,
    reference: text(body.reference, 100),
    notes: text(body.notes, 500),
  }
}

export async function transferCostSnapshot(tx: Tx, costId: string) {
  const c = await tx.stockTransferCost.findUniqueOrThrow({
    where: { id: costId },
    include: { type: { select: { name: true } }, paidToSupplier: { select: { name: true } } },
  })
  return { type: c.type.name, paidTo: c.paidToSupplier.name, amount: c.amount.toFixed(2), reference: c.reference }
}

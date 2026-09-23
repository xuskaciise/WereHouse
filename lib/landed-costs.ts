import type {
  LandedCostAllocation,
  LandedCostAmountType,
  LandedCostPercentBase,
  Prisma,
} from "@prisma/client"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, parseMoney, roundMoney, sumMoney } from "@/lib/money"
import { applyLandedCostDelta, roundUnitCost } from "@/lib/stock-valuation"

// Landed costs: extra costs of a purchase (shipment, customs, transport,
// commission...) allocated to the PO lines, so the received units are valued
// at their landed cost.
//
//   amount      FIXED: the value; PERCENT: value% of the goods value (PO
//               subtotal, before tax), or of goods + the other FIXED costs
//   allocation  by VALUE (qty x unit price, default), QUANTITY, WEIGHT or
//               VOLUME (qty x product weight/volume), or MANUAL amounts
//               (they must add up exactly to the cost)
//   rounding    to the cent per line; the difference goes to the last line,
//               so allocations always add up exactly
//   per unit    landed unit cost = unit price + allocated / quantity (4 decimals)
//
// Received units carry their share of the line's landed cost into the
// warehouse average cost. When costs or quantities change later, the change
// for the already received units is split between stock and COGS (see
// applyLandedCostDelta in lib/stock-valuation.ts).

type Tx = Prisma.TransactionClient
const HUNDRED = new Decimal(100)

// --- Pure planning (used by preview and by saving) ----------------------------

export interface PlanItem {
  id: string
  name: string
  quantity: number
  unitPrice: Money
  subtotal: Money
  weight: Money | null
  volume: Money | null
}

export interface PlanCost {
  id: string
  amountType: LandedCostAmountType
  value: Money
  percentBase: LandedCostPercentBase
  allocationMethod: LandedCostAllocation
  /** MANUAL: entered amount per item id (weights if the amount changes later). */
  manual: Map<string, Money> | null
}

export interface CostPlan {
  id: string
  amount: Money
  allocations: Map<string, Money>
}

export function goodsValue(items: PlanItem[]): Money {
  return sumMoney(items.map((i) => i.subtotal))
}

function costAmount(cost: PlanCost, goods: Money, fixedTotal: Money): Money {
  if (cost.amountType === "FIXED") return roundMoney(cost.value)
  const base = cost.percentBase === "GOODS_PLUS_FIXED" ? goods.plus(fixedTotal) : goods
  return roundMoney(base.times(cost.value).div(HUNDRED))
}

function weightsFor(cost: PlanCost, items: PlanItem[]): Money[] {
  switch (cost.allocationMethod) {
    case "VALUE":
      return items.map((i) => i.subtotal)
    case "QUANTITY":
      return items.map((i) => new Decimal(i.quantity))
    case "WEIGHT":
    case "VOLUME": {
      const field = cost.allocationMethod === "WEIGHT" ? "weight" : "volume"
      const missing = items.filter((i) => i.quantity > 0 && i[field] === null).map((i) => i.name)
      if (missing.length > 0) {
        throw new HttpError(400, `Set the ${field} of these products first (or choose another allocation): ${missing.join(", ")}`)
      }
      return items.map((i) => (i[field] ?? ZERO).times(i.quantity))
    }
    case "MANUAL":
      return items.map((i) => cost.manual?.get(i.id) ?? ZERO)
  }
}

/** Splits `amount` by `weights` to the cent; the rounding difference goes to the last weighted line. */
export function allocateAmount(amount: Money, weights: Money[]): Money[] {
  let w = weights
  let total = sumMoney(w)
  if (total.isZero()) {
    // Nothing to weigh by (e.g. every line closed at 0): split evenly.
    w = weights.map(() => new Decimal(1))
    total = new Decimal(weights.length)
  }
  const shares = w.map((x) => roundMoney(amount.times(x).div(total)))
  let last = -1
  w.forEach((x, i) => { if (!x.isZero()) last = i })
  if (last >= 0) {
    const others = sumMoney(shares.filter((_, i) => i !== last))
    shares[last] = amount.minus(others)
  }
  if (shares.some((s) => s.isNegative())) throw new HttpError(400, "Cost too small to allocate")
  return shares
}

export function planLandedCosts(items: PlanItem[], costs: PlanCost[]) {
  if (items.length === 0) throw new HttpError(400, "The purchase order has no items")
  const goods = goodsValue(items)
  const fixedTotal = sumMoney(costs.filter((c) => c.amountType === "FIXED").map((c) => roundMoney(c.value)))
  const planned: CostPlan[] = costs.map((cost) => {
    const amount = costAmount(cost, goods, fixedTotal)
    const shares = allocateAmount(amount, weightsFor(cost, items))
    return { id: cost.id, amount, allocations: new Map(items.map((item, i) => [item.id, shares[i]])) }
  })
  const itemTotals = new Map(items.map((item) => [item.id, sumMoney(planned.map((c) => c.allocations.get(item.id)))]))
  return { goods, fixedTotal, costs: planned, itemTotals, total: sumMoney(planned.map((c) => c.amount)) }
}

/** Per-item figures for the preview and the Landed Cost Report. */
export function itemCostFigures(item: PlanItem, landedCost: Money) {
  const perUnit = item.quantity > 0 ? roundUnitCost(landedCost.div(item.quantity)) : ZERO
  const landedUnitCost = roundUnitCost(item.unitPrice.plus(perUnit))
  const increasePercent = item.unitPrice.isZero()
    ? ZERO
    : perUnit.times(HUNDRED).div(item.unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  return { landedCost, perUnit, landedUnitCost, increasePercent }
}

// --- Loading -----------------------------------------------------------------

export const landedCostInclude = {
  type: true,
  paidToSupplier: { select: { id: true, name: true, type: true } },
  allocations: true,
  user: { select: { id: true, name: true, username: true } },
  supplierPayments: { select: { id: true, amount: true, paymentDate: true, paymentMethod: true } },
} satisfies Prisma.PurchaseLandedCostInclude

async function loadForPlanning(tx: Tx, purchaseOrderId: string) {
  return tx.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { product: { select: { name: true, weight: true, volume: true } }, receiveItems: true },
      },
      landedCosts: { orderBy: { createdAt: "asc" }, include: { allocations: true } },
    },
  })
}
type LoadedPo = Awaited<ReturnType<typeof loadForPlanning>>

export function toPlanItems(po: Pick<LoadedPo, "items">): PlanItem[] {
  return po.items.map((i) => ({
    id: i.id,
    name: i.product.name,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    subtotal: i.subtotal,
    weight: i.product.weight,
    volume: i.product.volume,
  }))
}

export function toPlanCost(cost: LoadedPo["landedCosts"][number]): PlanCost {
  return {
    id: cost.id,
    amountType: cost.amountType,
    value: cost.value,
    percentBase: cost.percentBase,
    allocationMethod: cost.allocationMethod,
    manual:
      cost.allocationMethod === "MANUAL"
        ? new Map(cost.allocations.map((a) => [a.purchaseOrderItemId, a.manualAmount ?? ZERO]))
        : null,
  }
}

// --- Saving + revaluation ------------------------------------------------------

/**
 * Recomputes every cost amount and allocation of the PO from the stored cost
 * lines and current quantities, then brings the value of already received
 * units in line (stock average / COGS). Call inside the transaction of any
 * change to costs or PO quantities, with the PO row locked.
 * Returns the landed cost per item after the update.
 */
export async function syncLandedCosts(tx: Tx, purchaseOrderId: string, userId: string) {
  const po = await loadForPlanning(tx, purchaseOrderId)
  const items = toPlanItems(po)
  const plan = planLandedCosts(items, po.landedCosts.map(toPlanCost))

  for (const planned of plan.costs) {
    const stored = po.landedCosts.find((c) => c.id === planned.id)!
    if (!stored.amount.equals(planned.amount)) {
      await tx.purchaseLandedCost.update({ where: { id: planned.id }, data: { amount: planned.amount } })
    }
    for (const [itemId, amount] of planned.allocations) {
      const existing = stored.allocations.find((a) => a.purchaseOrderItemId === itemId)
      if (existing?.amount.equals(amount)) continue
      await tx.purchaseLandedCostAllocation.upsert({
        where: { landedCostId_purchaseOrderItemId: { landedCostId: planned.id, purchaseOrderItemId: itemId } },
        update: { amount },
        create: { landedCostId: planned.id, purchaseOrderItemId: itemId, amount },
      })
    }
  }

  const result = new Map<string, { landedCost: Money; applied: Money }>()
  for (const item of po.items) {
    const landedCost = plan.itemTotals.get(item.id) ?? ZERO
    const received = item.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)
    const target = appliedTarget(landedCost, received, item.quantity)
    const delta = target.minus(item.appliedLandedCost)
    if (!delta.isZero()) {
      await applyLandedCostDelta(tx, {
        productId: item.productId,
        warehouseId: po.warehouseId,
        receivedUnits: received,
        delta,
        userId,
        purchaseOrderItemId: item.id,
      })
    }
    if (!landedCost.equals(item.landedCost) || !target.equals(item.appliedLandedCost)) {
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { landedCost, appliedLandedCost: target },
      })
    }
    result.set(item.id, { landedCost, applied: target })
  }
  return { ...plan, items: result }
}

/** Landed cost that belongs to `received` of `quantity` units, to the cent. */
function appliedTarget(landedCost: Money, received: number, quantity: number): Money {
  if (received <= 0) return ZERO
  if (quantity <= 0 || received >= quantity) return landedCost
  return roundMoney(landedCost.times(received).div(quantity))
}

/**
 * Value of `units` newly received units of a line: goods at the unit price
 * plus their share of the landed cost, so that after the receipt the applied
 * landed cost equals the share of all received units.
 */
export function receiptValue(
  item: { unitPrice: Money; quantity: number },
  costs: { landedCost: Money; applied: Money },
  receivedBefore: number,
  units: number
) {
  const target = appliedTarget(costs.landedCost, receivedBefore + units, item.quantity)
  const landedPortion = target.minus(costs.applied)
  return { value: roundMoney(item.unitPrice.times(units)).plus(landedPortion), appliedAfter: target }
}

// --- Input parsing ---------------------------------------------------------------

export interface LandedCostInput {
  typeId: string
  paidToSupplierId: string
  amountType: LandedCostAmountType
  value: Money
  percentBase: LandedCostPercentBase
  allocationMethod: LandedCostAllocation
  manual: Map<string, Money> | null
  reference: string | null
  costDate: Date
  notes: string | null
}

const AMOUNT_TYPES = ["FIXED", "PERCENT"] as const
const BASES = ["GOODS", "GOODS_PLUS_FIXED"] as const
const METHODS = ["VALUE", "QUANTITY", "WEIGHT", "VOLUME", "MANUAL"] as const

function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text`)
  const t = value.trim()
  if (t.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`)
  return t || null
}

export function parseLandedCostInput(body: any): LandedCostInput {
  if (typeof body?.typeId !== "string" || !body.typeId) throw new HttpError(400, "Cost type is required")
  if (typeof body.paidToSupplierId !== "string" || !body.paidToSupplierId) {
    throw new HttpError(400, "Paid-to party is required")
  }
  const amountType = body.amountType ?? "FIXED"
  if (!AMOUNT_TYPES.includes(amountType)) throw new HttpError(400, "Amount type must be FIXED or PERCENT")
  const percentBase = body.percentBase ?? "GOODS"
  if (!BASES.includes(percentBase)) throw new HttpError(400, "Percent base must be GOODS or GOODS_PLUS_FIXED")
  const allocationMethod = body.allocationMethod ?? "VALUE"
  if (!METHODS.includes(allocationMethod)) throw new HttpError(400, "Invalid allocation method")

  let value: Money
  if (amountType === "FIXED") {
    value = parseMoney(body.value, { field: "Amount" })
  } else {
    let parsed: Money
    try {
      parsed = new Decimal(body.value)
    } catch {
      throw new HttpError(400, "Percentage must be a number")
    }
    if (!parsed.isFinite() || parsed.lte(0) || parsed.gt(100) || parsed.decimalPlaces() > 4) {
      throw new HttpError(400, "Percentage must be greater than 0 and at most 100 (up to 4 decimals)")
    }
    value = parsed
  }

  let manual: Map<string, Money> | null = null
  if (allocationMethod === "MANUAL") {
    if (!Array.isArray(body.manual) || body.manual.length === 0) {
      throw new HttpError(400, "Manual allocation needs an amount per item")
    }
    manual = new Map()
    for (const row of body.manual) {
      if (typeof row?.itemId !== "string") throw new HttpError(400, "Each manual allocation needs an itemId")
      if (manual.has(row.itemId)) throw new HttpError(400, "Each item may appear only once")
      manual.set(row.itemId, parseMoney(row.amount ?? 0, { field: "Allocated amount", allowZero: true }))
    }
  }

  let costDate = new Date()
  if (body.costDate) {
    costDate = new Date(body.costDate)
    if (Number.isNaN(costDate.getTime())) throw new HttpError(400, "Invalid date")
  }

  return {
    typeId: body.typeId,
    paidToSupplierId: body.paidToSupplierId,
    amountType,
    value,
    percentBase,
    allocationMethod,
    manual,
    reference: text(body.reference, "Reference", 100),
    costDate,
    notes: text(body.notes, "Notes", 500),
  }
}

/** Manual amounts must cover exactly the PO's items and add up to the cost amount. */
export function assertManualMatches(input: LandedCostInput, items: PlanItem[], amount: Money): void {
  if (input.allocationMethod !== "MANUAL" || !input.manual) return
  const ids = new Set(items.map((i) => i.id))
  for (const id of input.manual.keys()) if (!ids.has(id)) throw new HttpError(400, "Manual allocation for an unknown item")
  const sum = sumMoney(input.manual.values())
  if (!sum.equals(amount)) {
    throw new HttpError(
      400,
      `Manual allocations add up to ${sum.toFixed(2)} but the cost is ${amount.toFixed(2)}; they must match exactly`
    )
  }
}

export function inputToPlanCost(id: string, input: LandedCostInput): PlanCost {
  return {
    id,
    amountType: input.amountType,
    value: input.value,
    percentBase: input.percentBase,
    allocationMethod: input.allocationMethod,
    manual: input.manual,
  }
}

export { loadForPlanning }

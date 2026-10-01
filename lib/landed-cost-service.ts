import type { Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { assertCanReference } from "@/lib/ownership"
import { postAccounting } from "@/lib/accounting"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, sumMoney } from "@/lib/money"
import { isAdmin, type SessionUser } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import type { Module } from "@/lib/permission-rules"
import { paidOf, paidStatus, recordCostPaymentInTx } from "@/lib/cost-payments"
import {
  type LandedCostInput,
  type PlanCost,
  assertManualMatches,
  inputToPlanCost,
  itemCostFigures,
  landedCostInclude,
  loadForPlanning,
  parseLandedCostInput,
  planLandedCosts,
  syncLandedCosts,
  toPlanCost,
  toPlanItems,
} from "@/lib/landed-costs"

type Db = Prisma.TransactionClient | typeof prisma
type Tx = Prisma.TransactionClient

// Access, finalize rule, audit log and response shape for the landed cost
// routes (app/api/purchase-orders/[id]/landed-costs/**).

/** 404 unless the PO exists and is within the user's scope for `mod`. */
export async function assertPurchaseOrderInScope(user: SessionUser, purchaseOrderId: string, mod: Module) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, ...scopeWhere(user, mod) },
    select: { id: true },
  })
  if (!po) throw new HttpError(404, "Purchase order not found")
}

export async function lockPurchaseOrder(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`
  return tx.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    select: { id: true, status: true, costsFinalizedAt: true },
  })
}

/**
 * Before "Costs finalized" anyone with the landed_costs permission may change
 * costs; afterwards only ADMIN, and a reason is required. Returns the reason.
 */
export function assertCostsEditable(
  user: SessionUser,
  po: { status: string; costsFinalizedAt: Date | null },
  rawReason: unknown
): string | null {
  if (po.status === "CANCELLED") throw new HttpError(400, "The purchase order is cancelled")
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 500) : null
  if (!po.costsFinalizedAt) return reason
  if (!isAdmin(user)) {
    throw new HttpError(403, "Costs are finalized for this purchase order; only an admin can change them")
  }
  if (!reason) throw new HttpError(400, "A reason is required to change finalized costs")
  return reason
}

export async function logLandedCost(
  tx: Prisma.TransactionClient,
  entry: {
    purchaseOrderId: string
    userId: string
    action: "CREATE" | "UPDATE" | "DELETE" | "FINALIZE" | "REOPEN"
    landedCostId?: string | null
    before?: unknown
    after?: unknown
    reason?: string | null
  }
) {
  await tx.landedCostLog.create({
    data: {
      purchaseOrderId: entry.purchaseOrderId,
      userId: entry.userId,
      action: entry.action,
      landedCostId: entry.landedCostId ?? null,
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: entry.reason ?? null,
    },
  })
}

/** Readable snapshot of a cost line for the log. */
export async function costSnapshot(db: Db, costId: string) {
  const cost = await db.purchaseLandedCost.findUniqueOrThrow({
    where: { id: costId },
    include: { type: true, paidToSupplier: { select: { name: true } } },
  })
  return {
    type: cost.type.name,
    paidTo: cost.paidToSupplier.name,
    amountType: cost.amountType,
    value: cost.value.toString(),
    percentBase: cost.percentBase,
    allocationMethod: cost.allocationMethod,
    amount: cost.amount.toFixed(2),
    reference: cost.reference,
    costDate: cost.costDate.toISOString().slice(0, 10),
    notes: cost.notes,
  }
}

/** Everything the PO's "Additional costs" section and the Landed Cost Report show. */
export async function landedCostView(db: Db, purchaseOrderId: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: {
      supplier: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: { product: { select: { id: true, name: true, sku: true, weight: true, volume: true } }, receiveItems: true },
      },
      landedCosts: { orderBy: { createdAt: "asc" }, include: landedCostInclude },
      landedCostLogs: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { user: { select: { id: true, name: true, username: true } } },
      },
    },
  })
  const finalizedBy = po.costsFinalizedById
    ? await db.user.findUnique({ where: { id: po.costsFinalizedById }, select: { name: true, username: true } })
    : null

  const goods = sumMoney(po.items.map((i) => i.subtotal))
  const total = sumMoney(po.landedCosts.map((c) => c.amount))
  const items = po.items.map((item) => {
    const figures = itemCostFigures(
      {
        id: item.id,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
        weight: item.product.weight,
        volume: item.product.volume,
      },
      item.landedCost
    )
    return {
      id: item.id,
      productId: item.productId,
      product: item.product,
      quantity: item.quantity,
      received: item.receiveItems.reduce((s, r) => s + r.quantityReceived, 0),
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      landedCost: figures.landedCost,
      costPerUnit: figures.perUnit,
      landedUnitCost: figures.landedUnitCost,
      costIncreasePercent: figures.increasePercent,
    }
  })
  const costs = po.landedCosts.map((cost) => {
    const paid = paidOf(cost.paymentAllocations)
    return {
      ...cost,
      paidAmount: paid,
      openAmount: cost.amount.minus(paid).isNegative() ? ZERO : cost.amount.minus(paid),
      paymentStatus: paidStatus(cost.amount, paid),
      allocations: cost.allocations,
    }
  })

  return {
    purchaseOrder: {
      id: po.id,
      orderNumber: po.orderNumber,
      status: po.status,
      orderDate: po.orderDate,
      supplier: po.supplier,
      warehouse: po.warehouse,
      costsFinalizedAt: po.costsFinalizedAt,
      costsFinalizedBy: finalizedBy,
    },
    goodsValue: goods,
    totalCosts: total,
    upliftPercent: goods.isZero() ? ZERO : total.times(100).div(goods).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    items,
    costs,
    logs: po.landedCostLogs,
  }
}

/**
 * Preview of the allocation with a draft cost (new or replacing `costId`),
 * without saving. Returns figures per item, or an error message to show.
 */
export async function previewLandedCosts(
  tx: Db,
  purchaseOrderId: string,
  draft: { costId: string | null; input: LandedCostInput | null; remove?: boolean }
) {
  const po = await loadForPlanning(tx as Prisma.TransactionClient, purchaseOrderId)
  const items = toPlanItems(po)
  let costs: PlanCost[] = po.landedCosts.map(toPlanCost)
  const draftId = draft.costId ?? "__draft__"
  if (draft.costId) costs = costs.filter((c) => c.id !== draft.costId)
  if (draft.input && !draft.remove) {
    costs.push({
      id: draftId,
      amountType: draft.input.amountType,
      value: draft.input.value,
      percentBase: draft.input.percentBase,
      allocationMethod: draft.input.allocationMethod,
      manual: draft.input.manual,
    })
  }
  const plan = planLandedCosts(items, costs)
  const draftPlan = plan.costs.find((c) => c.id === draftId) ?? null
  return {
    goodsValue: plan.goods,
    totalCosts: plan.total,
    upliftPercent: plan.goods.isZero() ? ZERO : plan.total.times(100).div(plan.goods).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    draftAmount: draftPlan?.amount ?? null,
    items: items.map((item) => ({
      id: item.id,
      product: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      draftAllocation: draftPlan?.allocations.get(item.id) ?? null,
      ...(() => {
        const f = itemCostFigures(item, plan.itemTotals.get(item.id) ?? ZERO)
        return { landedCost: f.landedCost, costPerUnit: f.perUnit, landedUnitCost: f.landedUnitCost, costIncreasePercent: f.increasePercent }
      })(),
    })),
  }
}

/** Cost type name: trimmed, single spaces, 1-60 characters. */
export function parseTypeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  if (!name) throw new HttpError(400, "Name is required")
  if (name.length > 60) throw new HttpError(400, "Name must be at most 60 characters")
  return name
}

export interface NewCostRow {
  input: LandedCostInput
  typeName: string
}

export interface PaidNow {
  paymentMethod: string
  payerPhone: string | null
  transactionId: string | null
  reference?: unknown
}

/**
 * Adds landed costs to a (locked, editable) purchase order in the caller's
 * transaction: amounts with the current quantities (all new rows planned
 * together, so a "% of goods + fixed costs" row sees the new fixed rows),
 * allocations, ONE stock / COGS revaluation, optional "paid now" (one supplier
 * payment per paid-to party) and the log. Errors that belong to one row carry
 * `rowErrors`. The caller posts the journal. Returns the new cost ids.
 */
export async function createLandedCostsInTx(
  tx: Tx,
  userId: string,
  purchaseOrderId: string,
  rows: NewCostRow[],
  options: { reason: string | null; paidNow?: PaidNow | null }
): Promise<string[]> {
  const loaded = await loadForPlanning(tx, purchaseOrderId)
  const items = toPlanItems(loaded)
  const draftId = (i: number) => `__new_${i}__`
  const plan = planLandedCosts(items, [...loaded.landedCosts.map(toPlanCost), ...rows.map((r, i) => inputToPlanCost(draftId(i), r.input))])

  const ids: string[] = []
  for (const [i, { input }] of rows.entries()) {
    const amount = plan.costs.find((c) => c.id === draftId(i))!.amount
    try {
      assertManualMatches(input, items, amount)
    } catch (e) {
      if (e instanceof HttpError) throw rowError(i, e.message)
      throw e
    }
    const cost = await tx.purchaseLandedCost.create({
      data: {
        purchaseOrderId,
        typeId: input.typeId,
        paidToSupplierId: input.paidToSupplierId,
        amountType: input.amountType,
        value: input.value,
        percentBase: input.percentBase,
        amount,
        allocationMethod: input.allocationMethod,
        reference: input.reference,
        costDate: input.costDate,
        notes: input.notes,
        userId,
        ...(input.manual && {
          allocations: {
            create: [...input.manual].map(([itemId, manualAmount]) => ({
              purchaseOrderItemId: itemId,
              manualAmount,
              amount: manualAmount,
            })),
          },
        }),
      },
    })
    ids.push(cost.id)
  }
  await syncLandedCosts(tx, purchaseOrderId, userId)

  const paid = options.paidNow
  if (paid) {
    // One payment per paid-to party, for the full (recalculated) amount of its new lines.
    const byParty = new Map<string, number[]>()
    rows.forEach((r, i) => byParty.set(r.input.paidToSupplierId, [...(byParty.get(r.input.paidToSupplierId) ?? []), i]))
    for (const [supplierId, indexes] of byParty) {
      const firstReference = indexes.map((i) => rows[i].input.reference).find(Boolean) ?? null
      await recordCostPaymentInTx(tx, null, userId, {
        supplierId,
        lines: indexes.map((i) => ({ kind: "LANDED_COST", id: ids[i] })),
        amount: null,
        method: paid,
        reference: typeof paid.reference === "string" ? paid.reference.trim() || null : firstReference,
        notes: indexes.length === 1 ? `Landed cost: ${rows[indexes[0]].typeName}` : null,
      })
    }
  }
  for (const id of ids) {
    await logLandedCost(tx, {
      purchaseOrderId,
      userId,
      action: "CREATE",
      landedCostId: id,
      after: await costSnapshot(tx, id),
      reason: options.reason,
    })
  }
  return ids
}

/** A 400 that points at one row of a multi-row form (0-based index). */
export function rowError(index: number, message: string) {
  return new HttpError(400, `Row ${index + 1}: ${message}`, { rowErrors: [{ row: index, message }] })
}

/** One landed cost (the single-cost form). See createLandedCostsInTx. */
export async function createLandedCostInTx(
  tx: Tx,
  userId: string,
  purchaseOrderId: string,
  input: LandedCostInput,
  options: { reason: string | null; typeName: string; paidNow?: PaidNow | null }
): Promise<string> {
  try {
    const [id] = await createLandedCostsInTx(tx, userId, purchaseOrderId, [{ input, typeName: options.typeName }], options)
    return id
  } catch (e) {
    // Single form: plain message without "Row 1:".
    if (e instanceof HttpError && Array.isArray(e.details?.rowErrors)) throw new HttpError(e.status, (e.details.rowErrors as any[])[0].message)
    throw e
  }
}

export const MAX_COST_ROWS = 30

export interface RowProblem {
  row: number
  message: string
}

/**
 * Validates the rows of the "Add costs" form one by one (same rules as a
 * single cost: input, active type, accessible paid-to party, allocation
 * possible). Returns the parsed rows (null where invalid) and the problems.
 */
export async function checkCostRows(user: SessionUser, purchaseOrderId: string, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "Add at least one cost row")
  if (raw.length > MAX_COST_ROWS) throw new HttpError(400, `At most ${MAX_COST_ROWS} cost rows at once`)
  const po = await loadForPlanning(prisma as unknown as Tx, purchaseOrderId)
  const items = toPlanItems(po)
  const types = new Map((await prisma.landedCostType.findMany({ select: { id: true, name: true, isActive: true } })).map((t) => [t.id, t]))

  const problems: RowProblem[] = []
  const rows: (NewCostRow | null)[] = []
  for (const [index, body] of (raw as unknown[]).entries()) {
    try {
      const input = parseLandedCostInput(body)
      const type = types.get(input.typeId)
      if (!type?.isActive) throw new HttpError(400, "Choose an active cost type")
      await assertCanReference(user, { supplierId: input.paidToSupplierId })
      // Allocation possible on its own (e.g. weights / volumes set).
      planLandedCosts(items, [inputToPlanCost("__row__", input)])
      if (input.manual) for (const id of input.manual.keys()) if (!items.some((i) => i.id === id)) throw new HttpError(400, "Manual allocation for an unknown item")
      rows.push({ input, typeName: type.name })
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 400) throw e
      problems.push({ row: index, message: e.message })
      rows.push(null)
    }
  }
  return { rows, problems }
}

/**
 * Live preview of several new rows together with the saved costs (nothing is
 * written): amount per row, totals, uplift and per-item figures with each
 * row's allocation. Same planning code as saving.
 */
export async function previewCostRows(db: Db, purchaseOrderId: string, rows: (NewCostRow | null)[]) {
  const po = await loadForPlanning(db as Tx, purchaseOrderId)
  const items = toPlanItems(po)
  const draftId = (i: number) => `__new_${i}__`
  const drafts = rows.flatMap((r, i) => (r ? [inputToPlanCost(draftId(i), r.input)] : []))
  const plan = planLandedCosts(items, [...po.landedCosts.map(toPlanCost), ...drafts])
  const rowPlans = rows.map((r, i) => (r ? plan.costs.find((c) => c.id === draftId(i)) ?? null : null))
  const problems: RowProblem[] = []
  rows.forEach((r, i) => {
    if (!r || r.input.allocationMethod !== "MANUAL" || !r.input.manual) return
    const entered = sumMoney(r.input.manual.values())
    const amount = rowPlans[i]!.amount
    if (!entered.equals(amount)) problems.push({ row: i, message: `Manual allocations add up to ${entered.toFixed(2)} but the cost is ${amount.toFixed(2)}` })
  })
  const newTotal = sumMoney(rowPlans.map((p) => p?.amount ?? ZERO))
  const savedTotal = plan.total.minus(newTotal)
  const uplift = (total: Money) => (plan.goods.isZero() ? ZERO : total.times(100).div(plan.goods).toDecimalPlaces(2, Decimal.ROUND_HALF_UP))
  return {
    goodsValue: plan.goods,
    savedCosts: savedTotal,
    newCosts: newTotal,
    totalCosts: plan.total,
    upliftPercent: uplift(plan.total),
    rows: rowPlans.map((p) => ({ amount: p?.amount ?? null })),
    problems,
    items: items.map((item) => {
      const f = itemCostFigures(item, plan.itemTotals.get(item.id) ?? ZERO)
      return {
        id: item.id,
        product: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        rowAllocations: rowPlans.map((p) => p?.allocations.get(item.id) ?? null),
        newAllocation: sumMoney(rowPlans.map((p) => p?.allocations.get(item.id) ?? ZERO)),
        landedCost: f.landedCost,
        costPerUnit: f.perUnit,
        landedUnitCost: f.landedUnitCost,
        costIncreasePercent: f.increasePercent,
      }
    }),
  }
}

/**
 * Saves the rows of the "Add costs" form: all or nothing, one revaluation and
 * one journal posting. Body: { rows: [cost], reason?, paidNow?: { paymentMethod,
 * payerPhone?, transactionId?, reference? } }. Row problems -> 400 with rowErrors.
 */
export async function createCostRows(user: SessionUser, purchaseOrderId: string, body: any, paidNow: PaidNow | null) {
  const { rows, problems } = await checkCostRows(user, purchaseOrderId, body?.rows)
  if (problems.length === 0) {
    // Problems that depend on all rows together (manual sums, % of goods + fixed).
    problems.push(...(await previewCostRows(prisma, purchaseOrderId, rows)).problems)
  }
  if (problems.length > 0) {
    throw new HttpError(400, problems.length === 1 ? `Row ${problems[0].row + 1}: ${problems[0].message}` : `${problems.length} rows need attention`, {
      rowErrors: problems,
    })
  }
  return prisma.$transaction(async (tx) => {
    const locked = await lockPurchaseOrder(tx, purchaseOrderId)
    const reason = assertCostsEditable(user, locked, body?.reason)
    const ids = await createLandedCostsInTx(tx, user.id, purchaseOrderId, rows as NewCostRow[], { reason, paidNow })
    await postAccounting(tx, {}, user.id)
    return ids
  }, TX_OPTIONS)
}

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, sumMoney } from "@/lib/money"
import { isAdmin, type SessionUser } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import type { Module } from "@/lib/permission-rules"
import {
  type LandedCostInput,
  type PlanCost,
  itemCostFigures,
  landedCostInclude,
  loadForPlanning,
  planLandedCosts,
  toPlanCost,
  toPlanItems,
} from "@/lib/landed-costs"

type Db = Prisma.TransactionClient | typeof prisma

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

function paidStatus(amount: Money, paid: Money) {
  if (paid.isZero()) return "UNPAID"
  return paid.gte(amount) ? "PAID" : "PARTLY_PAID"
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
    const paid = sumMoney(cost.supplierPayments.map((p) => p.amount))
    return {
      ...cost,
      paidAmount: paid,
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

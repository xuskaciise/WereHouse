import type { Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { postAccounting } from "@/lib/accounting"
import { assertCanReference } from "@/lib/ownership"
import { HttpError } from "@/lib/http-error"
import { type Money, ZERO, parseMoney, sumMoney } from "@/lib/money"
import { scopeWhere } from "@/lib/permissions"
import type { SessionUser } from "@/lib/auth-guard"
import { type PaymentFields, parsePaymentFields } from "@/lib/payment-fields"

// Paying cost lines: landed costs of purchase orders and stock transfer costs
// are payables to their paid-to party. A supplier payment settles one or many
// of them through supplier_payment_allocations; a line is PAID when its
// allocations reach its amount.
//
//   - one payment, one party: every line must be owed to the payment's supplier
//   - FIFO: an amount below the open total goes to the oldest lines first
//     (cost date, then entry time); the last line paid may be partly paid
//   - an amount above the open total is rejected (no unlinked overpayment;
//     an advance is recorded as a payment without cost lines)
//
// The journal (Dr Accounts payable / Cr cash) comes from the payment itself
// (lib/accounting.ts), so the payable and the AP ledger stay equal.

type Tx = Prisma.TransactionClient
type Db = Tx | typeof prisma

export type CostKind = "LANDED_COST" | "TRANSFER_COST"
export interface CostLineRef {
  kind: CostKind
  id: string
}

export function paidStatus(amount: Money, paid: Money) {
  if (paid.isZero()) return "UNPAID"
  return paid.gte(amount) ? "PAID" : "PARTLY_PAID"
}

/** Allocations of a cost line, with their payment (for paid status and history). */
export const paymentAllocationsSelect = {
  select: {
    id: true,
    amount: true,
    payment: { select: { id: true, paymentDate: true, paymentMethod: true, reference: true } },
  },
} satisfies Prisma.PurchaseLandedCost$paymentAllocationsArgs

export function paidOf(allocations: { amount: Money }[]): Money {
  return sumMoney(allocations.map((a) => a.amount))
}

export interface CostLine {
  kind: CostKind
  id: string
  supplierId: string
  supplierName: string
  documentId: string
  documentNumber: string
  typeName: string
  reference: string | null
  costDate: Date
  createdAt: Date
  amount: Money
  paidAmount: Money
  openAmount: Money
  paymentStatus: string
}

/** Oldest first: cost date, then entry time (FIFO). */
function fifo(a: CostLine, b: CostLine) {
  return a.costDate.getTime() - b.costDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
}

/**
 * Cost lines (both kinds) the user may pay, in FIFO order. Filters: supplier,
 * purchase order, stock transfer, explicit ids; `openOnly` leaves out paid lines.
 * `user` null = no scope (internal use inside a checked transaction).
 */
export async function listCostLines(
  db: Db,
  user: SessionUser | null,
  filter: {
    supplierId?: string | null
    purchaseOrderId?: string | null
    stockTransferId?: string | null
    ids?: CostLineRef[]
    openOnly?: boolean
  }
): Promise<CostLine[]> {
  const landedIds = filter.ids?.filter((r) => r.kind === "LANDED_COST").map((r) => r.id)
  const transferIds = filter.ids?.filter((r) => r.kind === "TRANSFER_COST").map((r) => r.id)
  const wantLanded = !filter.stockTransferId && (!filter.ids || landedIds!.length > 0)
  const wantTransfer = !filter.purchaseOrderId && (!filter.ids || transferIds!.length > 0)

  const [landed, transfer] = await Promise.all([
    wantLanded
      ? db.purchaseLandedCost.findMany({
          where: {
            ...(filter.supplierId && { paidToSupplierId: filter.supplierId }),
            ...(filter.purchaseOrderId && { purchaseOrderId: filter.purchaseOrderId }),
            ...(landedIds && { id: { in: landedIds } }),
            purchaseOrder: { status: { not: "CANCELLED" }, ...(user && scopeWhere(user, "purchases")) },
          },
          include: {
            type: { select: { name: true } },
            paidToSupplier: { select: { name: true } },
            purchaseOrder: { select: { id: true, orderNumber: true } },
            paymentAllocations: { select: { amount: true } },
          },
        })
      : [],
    wantTransfer
      ? db.stockTransferCost.findMany({
          where: {
            ...(filter.supplierId && { paidToSupplierId: filter.supplierId }),
            ...(filter.stockTransferId && { stockTransferId: filter.stockTransferId }),
            ...(transferIds && { id: { in: transferIds } }),
            stockTransfer: user ? scopeWhere(user, "stock_transfers") : {},
          },
          include: {
            type: { select: { name: true } },
            paidToSupplier: { select: { name: true } },
            stockTransfer: { select: { id: true, transferNumber: true } },
            paymentAllocations: { select: { amount: true } },
          },
        })
      : [],
  ])

  const line = (
    kind: CostKind,
    c: { id: string; paidToSupplierId: string; amount: Money; reference: string | null; costDate: Date; createdAt: Date; paymentAllocations: { amount: Money }[] },
    extra: { supplierName: string; documentId: string; documentNumber: string; typeName: string }
  ): CostLine => {
    const paid = paidOf(c.paymentAllocations)
    const open = c.amount.minus(paid)
    return {
      kind,
      id: c.id,
      supplierId: c.paidToSupplierId,
      reference: c.reference,
      costDate: c.costDate,
      createdAt: c.createdAt,
      amount: c.amount,
      paidAmount: paid,
      openAmount: open.isNegative() ? ZERO : open,
      paymentStatus: paidStatus(c.amount, paid),
      ...extra,
    }
  }
  const lines = [
    ...landed.map((c) =>
      line("LANDED_COST", c, { supplierName: c.paidToSupplier.name, documentId: c.purchaseOrder.id, documentNumber: c.purchaseOrder.orderNumber, typeName: c.type.name })
    ),
    ...transfer.map((c) =>
      line("TRANSFER_COST", c, { supplierName: c.paidToSupplier.name, documentId: c.stockTransfer.id, documentNumber: c.stockTransfer.transferNumber, typeName: c.type.name })
    ),
  ].sort(fifo)
  return filter.openOnly ? lines.filter((l) => l.openAmount.gt(0)) : lines
}

/**
 * Splits `amount` over the lines oldest first. Throws when the amount is more
 * than their open total. Returns only the lines that receive something.
 */
export function allocateFifo(lines: CostLine[], amount: Money): { line: CostLine; amount: Money }[] {
  const ordered = [...lines].sort(fifo)
  const open = sumMoney(ordered.map((l) => l.openAmount))
  if (amount.gt(open)) {
    throw new HttpError(
      400,
      `The amount (${amount.toFixed(2)}) is more than the open balance of the selected cost lines (${open.toFixed(2)}). ` +
        "Pay at most the open balance; record an advance as a separate payment without cost lines."
    )
  }
  let left = amount
  const result: { line: CostLine; amount: Money }[] = []
  for (const line of ordered) {
    if (left.lte(0)) break
    const part = left.lt(line.openAmount) ? left : line.openAmount
    if (part.gt(0)) result.push({ line, amount: part })
    left = left.minus(part)
  }
  return result
}

/** Body lines: [{ landedCostId } | { stockTransferCostId }] -> refs (no duplicates). */
export function parseCostLineRefs(raw: unknown): CostLineRef[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "Select at least one cost line")
  if (raw.length > 200) throw new HttpError(400, "At most 200 cost lines per payment")
  const seen = new Set<string>()
  return raw.map((r: any) => {
    const ref: CostLineRef | null =
      typeof r?.landedCostId === "string" && r.landedCostId
        ? { kind: "LANDED_COST", id: r.landedCostId }
        : typeof r?.stockTransferCostId === "string" && r.stockTransferCostId
          ? { kind: "TRANSFER_COST", id: r.stockTransferCostId }
          : null
    if (!ref) throw new HttpError(400, "Each cost line needs a landedCostId or a stockTransferCostId")
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) throw new HttpError(400, "Each cost line may appear only once")
    seen.add(key)
    return ref
  })
}

/** Row locks on the cost lines (sorted, so concurrent payments cannot deadlock). */
async function lockCostLines(tx: Tx, refs: CostLineRef[]) {
  const landed = refs.filter((r) => r.kind === "LANDED_COST").map((r) => r.id).sort()
  const transfer = refs.filter((r) => r.kind === "TRANSFER_COST").map((r) => r.id).sort()
  if (landed.length) await tx.$queryRaw`SELECT "id" FROM "purchase_landed_costs" WHERE "id" = ANY(${landed}::text[]) ORDER BY "id" FOR UPDATE`
  if (transfer.length) await tx.$queryRaw`SELECT "id" FROM "stock_transfer_costs" WHERE "id" = ANY(${transfer}::text[]) ORDER BY "id" FOR UPDATE`
}

export interface CostPaymentInput {
  supplierId: string
  lines: CostLineRef[]
  /** null = the open total of the lines. */
  amount: Money | null
  method: Pick<PaymentFields, "paymentMethod" | "payerPhone" | "transactionId">
  paymentDate?: Date | null
  reference?: string | null
  notes?: string | null
  /** Optional purchase order the payment is also linked to (as before). */
  purchaseOrderId?: string | null
}

/**
 * Records one supplier payment that settles the given cost lines (FIFO), inside
 * the caller's transaction: locks the lines, checks they are open and owed to
 * the supplier, creates the payment and its allocations. A payment for exactly
 * one line also keeps the direct link (landedCostId / stockTransferCostId).
 * The caller posts the journal (postAccounting). Returns the payment id.
 */
export async function recordCostPaymentInTx(tx: Tx, user: SessionUser | null, userId: string, input: CostPaymentInput) {
  await lockCostLines(tx, input.lines)
  const found = await listCostLines(tx, user, { ids: input.lines })
  if (found.length !== input.lines.length) throw new HttpError(400, "One or more cost lines were not found or are not accessible")
  const label = (l: CostLine) => `${l.typeName} (${l.documentNumber})`
  for (const l of found) {
    if (l.supplierId !== input.supplierId) throw new HttpError(400, `${label(l)} is owed to ${l.supplierName}, not to this supplier`)
    if (l.openAmount.lte(0)) throw new HttpError(400, `${label(l)} is already paid`)
  }
  const amount = input.amount ?? sumMoney(found.map((l) => l.openAmount))
  const parts = allocateFifo(found, amount)
  const single = found.length === 1 ? found[0] : null
  const notes =
    input.notes ??
    (`Costs: ${parts.map((p) => label(p.line)).join(", ")}`.length > 500
      ? `Costs: ${parts.length} lines`
      : `Costs: ${parts.map((p) => label(p.line)).join(", ")}`)

  const payment = await tx.supplierPayment.create({
    data: {
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      landedCostId: single?.kind === "LANDED_COST" ? single.id : null,
      stockTransferCostId: single?.kind === "TRANSFER_COST" ? single.id : null,
      amount,
      paymentDate: input.paymentDate ?? new Date(),
      paymentMethod: input.method.paymentMethod,
      payerPhone: input.method.payerPhone,
      transactionId: input.method.transactionId,
      reference: input.reference ?? null,
      notes,
      userId,
      allocations: {
        create: parts.map((p) => ({
          amount: p.amount,
          ...(p.line.kind === "LANDED_COST" ? { landedCostId: p.line.id } : { stockTransferCostId: p.line.id }),
        })),
      },
    },
  })
  return payment.id
}

/**
 * Amount change of a payment that settles cost lines: allowed only for a
 * payment of one line (its allocation follows, within the line's open
 * balance). A payment over several lines keeps its amount: delete it and
 * record it again.
 */
export async function updateCostPaymentAmountInTx(tx: Tx, paymentId: string, newAmount: Money) {
  const allocations = await tx.supplierPaymentAllocation.findMany({ where: { paymentId } })
  if (allocations.length === 0) return
  const current = sumMoney(allocations.map((a) => a.amount))
  if (current.equals(newAmount)) return
  if (allocations.length > 1) {
    throw new HttpError(400, "This payment settles several cost lines, so its amount cannot be changed. Delete it and record it again.")
  }
  const [allocation] = allocations
  const ref: CostLineRef = allocation.landedCostId
    ? { kind: "LANDED_COST", id: allocation.landedCostId }
    : { kind: "TRANSFER_COST", id: allocation.stockTransferCostId! }
  await lockCostLines(tx, [ref])
  const [line] = await listCostLines(tx, null, { ids: [ref] })
  const othersPaid = line ? line.paidAmount.minus(allocation.amount) : ZERO
  const maxAmount = line ? line.amount.minus(othersPaid) : ZERO
  if (newAmount.gt(maxAmount)) {
    throw new HttpError(400, `The amount is more than the open balance of ${line?.typeName ?? "the cost line"} (${maxAmount.toFixed(2)})`)
  }
  await tx.supplierPaymentAllocation.update({ where: { id: allocation.id }, data: { amount: newAmount } })
}

/** Cost lines a payment settled, for the receipt and the payment list. */
export const paymentAllocationsInclude = {
  orderBy: { createdAt: "asc" },
  include: {
    landedCost: { select: { id: true, amount: true, reference: true, type: { select: { name: true } }, purchaseOrder: { select: { id: true, orderNumber: true } } } },
    stockTransferCost: { select: { id: true, amount: true, reference: true, type: { select: { name: true } }, stockTransfer: { select: { id: true, transferNumber: true } } } },
  },
} satisfies Prisma.SupplierPayment$allocationsArgs

/**
 * Pays cost lines in one go: ONE payment per paid-to party, each settling its
 * selected lines FIFO; all payments of the call in one transaction (all or
 * none) with the journal. Body: { payments: [{ supplierId, lines, amount?,
 * paymentMethod, payerPhone?, transactionId?, paymentDate?, reference?, notes? }] }
 * or one such payment object. Returns the payment ids and method warnings.
 */
export async function payCostLines(user: SessionUser, body: any) {
  const raw: any[] = Array.isArray(body?.payments) ? body.payments : [body]
  if (raw.length === 0 || raw.length > 20) throw new HttpError(400, "Send between 1 and 20 payments")

  const parsed: (CostPaymentInput & { method: PaymentFields })[] = []
  for (const p of raw) {
    if (typeof p?.supplierId !== "string" || !p.supplierId) throw new HttpError(400, "Supplier is required")
    await assertCanReference(user, { supplierId: p.supplierId })
    let paymentDate = new Date()
    if (p.paymentDate) {
      paymentDate = new Date(p.paymentDate)
      if (Number.isNaN(paymentDate.getTime())) throw new HttpError(400, "Invalid payment date")
    }
    parsed.push({
      supplierId: p.supplierId,
      lines: parseCostLineRefs(p.lines),
      amount: p.amount === undefined || p.amount === null || p.amount === "" ? null : parseMoney(p.amount),
      method: await parsePaymentFields(p),
      paymentDate,
      reference: typeof p.reference === "string" ? p.reference.trim().slice(0, 100) || null : null,
      notes: typeof p.notes === "string" ? p.notes.trim().slice(0, 500) || null : null,
    })
  }
  if (new Set(parsed.map((p) => p.supplierId)).size !== parsed.length) throw new HttpError(400, "One payment per paid-to party")

  const ids = await prisma.$transaction(async (tx) => {
    const created: string[] = []
    for (const p of parsed) created.push(await recordCostPaymentInTx(tx, user, user.id, p))
    await postAccounting(tx, {}, user.id)
    return created
  }, TX_OPTIONS)
  return { ids, warnings: parsed.flatMap((p) => p.method.warnings) }
}

/** FIFO split of `amount` (default: the open balance) over the lines, without saving. */
export async function previewCostPayment(user: SessionUser, body: any) {
  const refs = parseCostLineRefs(body?.lines)
  const lines = await listCostLines(prisma, user, { ids: refs })
  if (lines.length !== refs.length) throw new HttpError(400, "One or more cost lines were not found or are not accessible")
  if (lines.some((l) => l.supplierId !== body?.supplierId)) throw new HttpError(400, "Every line must be owed to the same party")
  const open = sumMoney(lines.map((l) => l.openAmount))
  const amount = body?.amount === undefined || body?.amount === null || body?.amount === "" ? open : parseMoney(body.amount)
  const parts = allocateFifo(lines, amount)
  return {
    amount,
    openTotal: open,
    lines: lines.map((l) => {
      const part = parts.find((p) => p.line.kind === l.kind && p.line.id === l.id)?.amount ?? null
      return { ...l, allocated: part, remaining: l.openAmount.minus(part ?? ZERO) }
    }),
  }
}

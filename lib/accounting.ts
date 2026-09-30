import { Prisma } from "@prisma/client"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, roundMoney, sumMoney } from "@/lib/money"
import { nextDocumentNumber } from "@/lib/orders"

// Automatic double-entry bookkeeping.
//
// Every business document has a DESIRED journal: its debits (+) and credits
// (-) per account, computed from the document as it is now (see desired()).
// syncSource() compares that with what was already posted for the document
// (the sum of all journal entries with its sourceType/sourceId) and posts
// ONE new entry with the difference:
//   - a new document gets its full entry, dated with the document date
//   - an edit posts only the change, a delete reverses what was posted
//     (dated now, marked isAdjustment)
// Entries are never changed or deleted (database triggers); every entry
// balances (deferred constraint trigger). Posting runs inside the business
// transaction (postAccounting), so documents and journal commit together.
//
// Account links: product override -> category default -> system account
// (Inventory / Sales / COGS); expense category -> its expense account ->
// "Other Operating Expenses"; payment method -> Cash / Bank / Mobile Money.

type Tx = Prisma.TransactionClient

export const SOURCE_TYPES = [
  "VALUATION",
  "PURCHASE_ORDER",
  "LANDED_COST",
  "TRANSFER_COST",
  "SALES_DELIVERY",
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "CUSTOMER_PAYMENT",
  "SUPPLIER_PAYMENT",
  "EXPENSE",
  "OPENING_BALANCE",
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const SOURCE_LABELS: Record<SourceType, string> = {
  VALUATION: "Stock valuation",
  PURCHASE_ORDER: "Purchase receipt",
  LANDED_COST: "Landed cost",
  TRANSFER_COST: "Transfer cost",
  SALES_DELIVERY: "Sales delivery",
  SALES_RETURN: "Sales return",
  PURCHASE_RETURN: "Purchase return",
  CUSTOMER_PAYMENT: "Customer payment",
  SUPPLIER_PAYMENT: "Supplier payment",
  EXPENSE: "Expense",
  OPENING_BALANCE: "Opening balance",
}

/** Valuation entry types that post their own journal (the others belong to a return document). */
const POSTED_VALUATION_TYPES = [
  "RECEIPT",
  "LANDED_COST",
  "COGS_ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "TRANSFER_LOSS",
  "TRANSFER_RETURN",
  "STOCK_ADJUSTMENT",
  "OPENING_STOCK",
] as const

export const SYSTEM_ACCOUNTS = [
  "CASH",
  "BANK",
  "MM_EVC_PLUS",
  "MM_ZAAD",
  "MM_EDAHAB",
  "AR",
  "INVENTORY",
  "INVENTORY_IN_TRANSIT",
  "PURCHASE_CLEARING",
  "AP",
  "SALES_TAX",
  "OPENING_EQUITY",
  "RETAINED_EARNINGS",
  "SALES",
  "SALES_RETURNS",
  "PURCHASE_DISCOUNTS",
  "COGS",
  "INVENTORY_LOSSES",
  "PURCHASE_RETURN_DIFF",
  "PURCHASE_TAX",
  "OTHER_EXPENSES",
] as const
export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[number]

const PAYMENT_ACCOUNT: Record<string, SystemAccount> = {
  CASH: "CASH",
  OTHER: "CASH",
  EVC_PLUS: "MM_EVC_PLUS",
  ZAAD: "MM_ZAAD",
  EDAHAB: "MM_EDAHAB",
  BANK_TRANSFER: "BANK",
  CREDIT_CARD: "BANK",
  CHECK: "BANK",
}

// --- Account resolution (cached per posting run) --------------------------------------

type ProductKind = "inventory" | "sales" | "cogs"

class AccountBook {
  private system = new Map<string, string>()
  private products = new Map<string, Record<ProductKind, string | null>>()
  private expenseCategories = new Map<string, string | null>()
  constructor(private tx: Tx) {}

  async load() {
    const rows = await this.tx.account.findMany({ where: { systemKey: { not: null } }, select: { id: true, systemKey: true } })
    for (const r of rows) this.system.set(r.systemKey!, r.id)
  }

  sys(key: SystemAccount): string {
    const id = this.system.get(key)
    if (!id) throw new HttpError(500, `System account ${key} is missing from the chart of accounts`)
    return id
  }

  payment(method: string | null | undefined): string {
    return this.sys(PAYMENT_ACCOUNT[method ?? ""] ?? "CASH")
  }

  async product(productId: string, kind: ProductKind): Promise<string> {
    let links = this.products.get(productId)
    if (!links) {
      const p = await this.tx.product.findUnique({
        where: { id: productId },
        select: {
          inventoryAccountId: true,
          salesAccountId: true,
          cogsAccountId: true,
          category: { select: { inventoryAccountId: true, salesAccountId: true, cogsAccountId: true } },
        },
      })
      links = {
        inventory: p?.inventoryAccountId ?? p?.category.inventoryAccountId ?? null,
        sales: p?.salesAccountId ?? p?.category.salesAccountId ?? null,
        cogs: p?.cogsAccountId ?? p?.category.cogsAccountId ?? null,
      }
      this.products.set(productId, links)
    }
    return links[kind] ?? this.sys(kind === "inventory" ? "INVENTORY" : kind === "sales" ? "SALES" : "COGS")
  }

  async expenseCategory(categoryId: string): Promise<string> {
    if (!this.expenseCategories.has(categoryId)) {
      const c = await this.tx.expenseCategory.findUnique({ where: { id: categoryId }, select: { accountId: true } })
      this.expenseCategories.set(categoryId, c?.accountId ?? null)
    }
    return this.expenseCategories.get(categoryId) ?? this.sys("OTHER_EXPENSES")
  }
}

// --- Desired journal per document ---------------------------------------------------

interface Posting {
  accountId: string
  amount: Money // + debit, - credit
  memo?: string
}
interface Desired {
  date: Date
  description: string
  reference: string | null
  userId: string | null
  lines: Posting[]
}

const dr = (accountId: string, amount: Money, memo?: string): Posting => ({ accountId, amount, memo })
const cr = (accountId: string, amount: Money, memo?: string): Posting => ({ accountId, amount: amount.neg(), memo })

async function desiredValuation(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const v = await tx.inventoryValuationEntry.findUnique({
    where: { id },
    include: {
      product: { select: { name: true } },
      stockTransferItem: { select: { unitCost: true, stockTransfer: { select: { transferNumber: true } } } },
      purchaseOrderItem: { select: { purchaseOrder: { select: { orderNumber: true } } } },
    },
  })
  if (!v || !(POSTED_VALUATION_TYPES as readonly string[]).includes(v.type)) return null
  const inv = await book.product(v.productId, "inventory")
  const amount = v.amount
  const ref = v.stockTransferItem?.stockTransfer.transferNumber ?? v.purchaseOrderItem?.purchaseOrder.orderNumber ?? null
  const base = { date: v.createdAt, reference: ref, userId: v.userId }
  const name = v.product.name

  // Transfer goods leave / arrive at the dispatch cost; anything above it is
  // transfer cost coming out of the clearing account. Cumulative rounding per
  // transfer line keeps "in transit" exact.
  const goodsPart = async () => {
    if (!v.stockTransferItemId || !v.stockTransferItem || v.quantity <= 0) return ZERO
    const earlier = await tx.inventoryValuationEntry.aggregate({
      where: {
        stockTransferItemId: v.stockTransferItemId,
        type: { in: ["TRANSFER_IN", "TRANSFER_RETURN", "TRANSFER_LOSS"] },
        quantity: { gt: 0 },
        OR: [{ createdAt: { lt: v.createdAt } }, { createdAt: v.createdAt, id: { lt: v.id } }],
      },
      _sum: { quantity: true },
    })
    const before = earlier._sum.quantity ?? 0
    const u = v.stockTransferItem.unitCost
    return roundMoney(u.times(before + v.quantity)).minus(roundMoney(u.times(before)))
  }

  switch (v.type) {
    case "RECEIPT":
      return { ...base, description: `Goods received: ${name}`, lines: [dr(inv, amount), cr(book.sys("PURCHASE_CLEARING"), amount)] }
    case "LANDED_COST":
      return { ...base, description: `Landed / transfer cost added to stock: ${name}`, lines: [dr(inv, amount), cr(book.sys("PURCHASE_CLEARING"), amount)] }
    case "COGS_ADJUSTMENT":
      return {
        ...base,
        description: `Landed cost of goods already sold: ${name}`,
        lines: [dr(await book.product(v.productId, "cogs"), amount), cr(book.sys("PURCHASE_CLEARING"), amount)],
      }
    case "TRANSFER_OUT":
      return { ...base, description: `Transfer dispatched: ${name}`, lines: [dr(book.sys("INVENTORY_IN_TRANSIT"), amount), cr(inv, amount)] }
    case "TRANSFER_IN":
    case "TRANSFER_RETURN": {
      const goods = await goodsPart()
      return {
        ...base,
        description: `${v.type === "TRANSFER_IN" ? "Transfer received" : "Transfer returned to source"}: ${name}`,
        lines: [dr(inv, amount), cr(book.sys("INVENTORY_IN_TRANSIT"), goods), cr(book.sys("PURCHASE_CLEARING"), amount.minus(goods))],
      }
    }
    case "TRANSFER_LOSS": {
      const goods = await goodsPart()
      return {
        ...base,
        description: `Transfer loss: ${name}`,
        lines: [dr(book.sys("INVENTORY_LOSSES"), amount), cr(book.sys("INVENTORY_IN_TRANSIT"), goods), cr(book.sys("PURCHASE_CLEARING"), amount.minus(goods))],
      }
    }
    case "STOCK_ADJUSTMENT":
      return {
        ...base,
        description: `Stock adjustment (${v.quantity > 0 ? "+" : ""}${v.quantity}): ${name}`,
        lines: [dr(inv, amount), cr(book.sys("INVENTORY_LOSSES"), amount)],
      }
    case "OPENING_STOCK":
      return { ...base, description: `Opening stock: ${name}`, lines: [dr(inv, amount), cr(book.sys("OPENING_EQUITY"), amount)] }
  }
  return null
}

async function desiredPurchaseOrder(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const po = await tx.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { receiveItems: true } }, receives: { orderBy: { createdAt: "asc" }, take: 1 }, supplier: { select: { name: true } } },
  })
  if (!po || po.receives.length === 0) return null
  // Payable for the RECEIVED goods, with their share of the order tax and discount.
  const goods = sumMoney(po.items.map((i) => roundMoney(i.unitPrice.times(i.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)))))
  if (goods.isZero()) return null
  const share = (v: Money) => (po.subtotal.isZero() ? ZERO : goods.gte(po.subtotal) ? v : roundMoney(v.times(goods).div(po.subtotal)))
  const tax = share(po.tax)
  const discount = share(po.discount)
  return {
    date: po.receives[0].createdAt,
    description: `Goods received from ${po.supplier.name} (${po.orderNumber})`,
    reference: po.orderNumber,
    userId: po.userId,
    lines: [
      dr(book.sys("PURCHASE_CLEARING"), goods, "Received goods at order price"),
      dr(book.sys("PURCHASE_TAX"), tax),
      cr(book.sys("PURCHASE_DISCOUNTS"), discount),
      cr(book.sys("AP"), goods.plus(tax).minus(discount)),
    ],
  }
}

async function desiredLandedCost(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const c = await tx.purchaseLandedCost.findUnique({
    where: { id },
    include: { purchaseOrder: { select: { orderNumber: true, status: true } }, paidToSupplier: { select: { name: true } }, type: { select: { name: true } } },
  })
  if (!c || c.purchaseOrder.status === "CANCELLED") return null
  return {
    date: c.costDate,
    description: `${c.type.name} for ${c.purchaseOrder.orderNumber} (${c.paidToSupplier.name})`,
    reference: c.purchaseOrder.orderNumber,
    userId: c.userId,
    lines: [dr(book.sys("PURCHASE_CLEARING"), c.amount), cr(book.sys("AP"), c.amount)],
  }
}

async function desiredTransferCost(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const c = await tx.stockTransferCost.findUnique({
    where: { id },
    include: { stockTransfer: { select: { transferNumber: true } }, paidToSupplier: { select: { name: true } }, type: { select: { name: true } } },
  })
  if (!c) return null
  return {
    date: c.costDate,
    description: `${c.type.name} for ${c.stockTransfer.transferNumber} (${c.paidToSupplier.name})`,
    reference: c.stockTransfer.transferNumber,
    userId: c.userId,
    lines: [dr(book.sys("PURCHASE_CLEARING"), c.amount), cr(book.sys("AP"), c.amount)],
  }
}

async function desiredDelivery(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const d = await tx.salesDelivery.findUnique({
    where: { id },
    include: { items: true, salesOrder: { select: { orderNumber: true, customer: { select: { name: true } } } } },
  })
  if (!d) return null
  const lines: Posting[] = [dr(book.sys("AR"), d.total), cr(book.sys("SALES_TAX"), d.tax)]
  for (const i of d.items) {
    lines.push(cr(await book.product(i.productId, "sales"), i.amount.minus(i.discount)))
    lines.push(dr(await book.product(i.productId, "cogs"), i.cogs), cr(await book.product(i.productId, "inventory"), i.cogs))
  }
  return {
    date: d.deliveredAt,
    description: `Delivery ${d.deliveryNumber} to ${d.salesOrder.customer.name} (${d.salesOrder.orderNumber})`,
    reference: d.deliveryNumber,
    userId: d.userId,
    lines,
  }
}

async function desiredSalesReturn(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const r = await tx.salesReturn.findUnique({ where: { id }, include: { items: true, customer: { select: { name: true } } } })
  if (!r) return null
  const lines: Posting[] = [cr(book.sys("AR"), r.total), dr(book.sys("SALES_TAX"), r.tax)]
  for (const i of r.items) {
    lines.push(dr(book.sys("SALES_RETURNS"), i.amount.minus(i.discount)))
    const back = i.condition === "RESELLABLE" ? await book.product(i.productId, "inventory") : book.sys("INVENTORY_LOSSES")
    lines.push(dr(back, i.cogs, i.condition === "DAMAGED" ? "Damaged return" : undefined), cr(await book.product(i.productId, "cogs"), i.cogs))
  }
  if (r.refundAmount.gt(0)) lines.push(dr(book.sys("AR"), r.refundAmount, "Refund"), cr(book.payment(r.refundMethod), r.refundAmount, "Refund"))
  return { date: r.returnDate, description: `Credit note ${r.returnNumber} for ${r.customer.name}`, reference: r.returnNumber, userId: r.userId, lines }
}

async function desiredPurchaseReturn(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const r = await tx.purchaseReturn.findUnique({ where: { id }, include: { items: true, supplier: { select: { name: true } } } })
  if (!r) return null
  const lines: Posting[] = [dr(book.sys("AP"), r.creditTotal), dr(book.sys("PURCHASE_DISCOUNTS"), r.discount), cr(book.sys("PURCHASE_TAX"), r.tax)]
  for (const i of r.items) lines.push(cr(await book.product(i.productId, "inventory"), i.costValue))
  // Goods credited at the purchase price vs. their stock value (landed cost not refunded, price changes).
  lines.push(cr(book.sys("PURCHASE_RETURN_DIFF"), r.goodsAmount.minus(r.costValue)))
  if (r.refundAmount.gt(0)) lines.push(dr(book.payment(r.refundMethod), r.refundAmount, "Refund"), cr(book.sys("AP"), r.refundAmount, "Refund"))
  return { date: r.returnDate, description: `Return ${r.returnNumber} to ${r.supplier.name}`, reference: r.returnNumber, userId: r.userId, lines }
}

async function desiredCustomerPayment(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const p = await tx.customerPayment.findUnique({ where: { id }, include: { customer: { select: { name: true } }, salesOrder: { select: { orderNumber: true } } } })
  if (!p) return null
  return {
    date: p.paymentDate,
    description: `Payment from ${p.customer.name}${p.salesOrder ? ` (${p.salesOrder.orderNumber})` : ""}`,
    reference: p.reference ?? p.salesOrder?.orderNumber ?? null,
    userId: p.userId,
    lines: [dr(book.payment(p.paymentMethod), p.amount), cr(book.sys("AR"), p.amount)],
  }
}

async function desiredSupplierPayment(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const p = await tx.supplierPayment.findUnique({ where: { id }, include: { supplier: { select: { name: true } }, purchaseOrder: { select: { orderNumber: true } } } })
  if (!p) return null
  return {
    date: p.paymentDate,
    description: `Payment to ${p.supplier.name}${p.purchaseOrder ? ` (${p.purchaseOrder.orderNumber})` : ""}`,
    reference: p.reference ?? p.purchaseOrder?.orderNumber ?? null,
    userId: p.userId,
    lines: [dr(book.sys("AP"), p.amount), cr(book.payment(p.paymentMethod), p.amount)],
  }
}

async function desiredExpense(tx: Tx, book: AccountBook, id: string): Promise<Desired | null> {
  const e = await tx.expense.findUnique({ where: { id }, include: { category: { select: { name: true } } } })
  if (!e) return null
  return {
    date: e.expenseDate,
    description: `${e.category.name}: ${e.description}`.slice(0, 300),
    reference: e.reference,
    userId: e.userId,
    lines: [dr(await book.expenseCategory(e.categoryId), e.amount), cr(book.payment(e.paymentMethod), e.amount)],
  }
}

const DESIRED: Record<Exclude<SourceType, "OPENING_BALANCE">, (tx: Tx, book: AccountBook, id: string) => Promise<Desired | null>> = {
  VALUATION: desiredValuation,
  PURCHASE_ORDER: desiredPurchaseOrder,
  LANDED_COST: desiredLandedCost,
  TRANSFER_COST: desiredTransferCost,
  SALES_DELIVERY: desiredDelivery,
  SALES_RETURN: desiredSalesReturn,
  PURCHASE_RETURN: desiredPurchaseReturn,
  CUSTOMER_PAYMENT: desiredCustomerPayment,
  SUPPLIER_PAYMENT: desiredSupplierPayment,
  EXPENSE: desiredExpense,
}

// --- Posting ---------------------------------------------------------------------------

function netByAccount(lines: Posting[]): Map<string, Money> {
  const map = new Map<string, Money>()
  for (const l of lines) map.set(l.accountId, (map.get(l.accountId) ?? ZERO).plus(l.amount))
  return map
}

/** Posts the difference between the document's desired journal and what is posted. Returns true if an entry was made. */
async function syncSource(tx: Tx, book: AccountBook, type: Exclude<SourceType, "OPENING_BALANCE">, id: string, actorId?: string): Promise<boolean> {
  // One posting at a time per document (concurrent requests on the same document).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`journal:${type}:${id}`}))`
  const desired = await DESIRED[type](tx, book, id)
  const want = netByAccount(desired?.lines ?? [])
  if (!sumMoney([...want.values()]).isZero()) throw new HttpError(500, `Unbalanced journal for ${type} ${id}`)

  const posted = await tx.$queryRaw<{ accountId: string; net: Prisma.Decimal }[]>`
    SELECT l."accountId", SUM(l."debit" - l."credit") AS net
    FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
    WHERE e."sourceType" = ${type} AND e."sourceId" = ${id}
    GROUP BY l."accountId"`
  const first = posted.length === 0
  const diff = new Map(want)
  for (const p of posted) diff.set(p.accountId, (diff.get(p.accountId) ?? ZERO).minus(p.net))
  const lines = [...diff].filter(([, amount]) => !amount.isZero())
  if (lines.length === 0) return false

  // Memo of the desired line (first one per account) for readability.
  const memo = new Map<string, string>()
  for (const l of desired?.lines ?? []) if (l.memo && !memo.has(l.accountId)) memo.set(l.accountId, l.memo)
  const entryNumber = await nextDocumentNumber(tx, "JE", "journal_entries", "entryNumber")
  await tx.journalEntry.create({
    data: {
      entryNumber,
      date: first && desired ? desired.date : new Date(),
      description: first && desired ? desired.description : `Correction: ${desired?.description ?? `${SOURCE_LABELS[type]} deleted or cancelled`}`.slice(0, 300),
      sourceType: type,
      sourceId: id,
      reference: desired?.reference ?? null,
      isAdjustment: !first,
      // The document's owner (OWN-scope reports); the actor only for deleted documents.
      userId: desired?.userId ?? actorId ?? null,
      lines: {
        create: lines.map(([accountId, amount]) => ({
          accountId,
          debit: amount.gt(0) ? amount : ZERO,
          credit: amount.lt(0) ? amount.neg() : ZERO,
          memo: memo.get(accountId) ?? null,
        })),
      },
    },
  })
  return true
}

export type AccountingKeys = Partial<Record<Exclude<SourceType, "OPENING_BALANCE">, (string | null | undefined)[]>>

/**
 * Posts the journal for everything created in the CURRENT transaction (rows
 * whose xmin is this transaction) plus the given documents (edits and deletes).
 * Call it at the end of every business transaction that changes money or stock.
 */
export async function postAccounting(tx: Tx, keys: AccountingKeys = {}, actorId?: string): Promise<number> {
  const book = new AccountBook(tx)
  await book.load()
  const own = await tx.$queryRaw<{ type: string; id: string; at: Date }[]>`
    SELECT 'VALUATION' AS type, "id", "createdAt" AS at FROM "inventory_valuation_entries"
      WHERE xmin = pg_current_xact_id()::xid AND "type"::text IN (${Prisma.join([...POSTED_VALUATION_TYPES])})
    UNION ALL SELECT 'SALES_DELIVERY', "id", "deliveredAt" FROM "sales_deliveries" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'SALES_RETURN', "id", "returnDate" FROM "sales_returns" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'PURCHASE_RETURN', "id", "returnDate" FROM "purchase_returns" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'CUSTOMER_PAYMENT', "id", "paymentDate" FROM "customer_payments" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'SUPPLIER_PAYMENT', "id", "paymentDate" FROM "supplier_payments" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'EXPENSE', "id", "expenseDate" FROM "expenses" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'LANDED_COST', "id", "costDate" FROM "purchase_landed_costs" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'TRANSFER_COST', "id", "costDate" FROM "stock_transfer_costs" WHERE xmin = pg_current_xact_id()::xid
    UNION ALL SELECT 'PURCHASE_ORDER', "purchaseOrderId", "createdAt" FROM "purchase_receives" WHERE xmin = pg_current_xact_id()::xid`
  const todo: { type: Exclude<SourceType, "OPENING_BALANCE">; id: string; at: number }[] = own.map((r) => ({
    type: r.type as Exclude<SourceType, "OPENING_BALANCE">,
    id: r.id,
    at: new Date(r.at).getTime(),
  }))
  for (const [type, ids] of Object.entries(keys)) {
    for (const id of ids ?? []) if (id) todo.push({ type: type as Exclude<SourceType, "OPENING_BALANCE">, id, at: Date.now() })
  }
  todo.sort((a, b) => a.at - b.at)
  const seen = new Set<string>()
  let posted = 0
  for (const t of todo) {
    const key = `${t.type}:${t.id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (await syncSource(tx, book, t.type, t.id, actorId)) posted++
  }
  await checkBalancedNow(tx)
  return posted
}

/**
 * Runs the deferred "entry balances" check NOW, inside the transaction.
 * Prisma does not report a failure raised at COMMIT (the transaction is
 * rolled back silently), so the check must fail as a normal statement.
 */
async function checkBalancedNow(tx: Tx) {
  await tx.$executeRaw`SET CONSTRAINTS "journal_lines_balanced" IMMEDIATE`
}

// --- Backfill / full sync -----------------------------------------------------------------

/** All documents that should have a journal, oldest first. */
async function allSources(tx: Tx | Prisma.TransactionClient) {
  return tx.$queryRaw<{ type: string; id: string; at: Date }[]>`
    SELECT 'VALUATION' AS type, "id", "createdAt" AS at FROM "inventory_valuation_entries" WHERE "type"::text IN (${Prisma.join([...POSTED_VALUATION_TYPES])})
    UNION ALL SELECT 'SALES_DELIVERY', "id", "deliveredAt" FROM "sales_deliveries"
    UNION ALL SELECT 'SALES_RETURN', "id", "returnDate" FROM "sales_returns"
    UNION ALL SELECT 'PURCHASE_RETURN', "id", "returnDate" FROM "purchase_returns"
    UNION ALL SELECT 'CUSTOMER_PAYMENT', "id", "paymentDate" FROM "customer_payments"
    UNION ALL SELECT 'SUPPLIER_PAYMENT', "id", "paymentDate" FROM "supplier_payments"
    UNION ALL SELECT 'EXPENSE', "id", "expenseDate" FROM "expenses"
    UNION ALL SELECT 'LANDED_COST', "id", "costDate" FROM "purchase_landed_costs"
    UNION ALL SELECT 'TRANSFER_COST', "id", "costDate" FROM "stock_transfer_costs"
    UNION ALL SELECT 'PURCHASE_ORDER', po."id", MIN(r."createdAt") FROM "purchase_orders" po JOIN "purchase_receives" r ON r."purchaseOrderId" = po."id" GROUP BY po."id"
    UNION ALL SELECT DISTINCT e."sourceType", e."sourceId", MIN(e."date") OVER (PARTITION BY e."sourceType", e."sourceId") FROM "journal_entries" e WHERE e."sourceType" <> 'OPENING_BALANCE'
    ORDER BY at, id`
}

/**
 * Backfill / repair: brings every document's journal in line with the
 * document (idempotent, in batches), then - once - books the difference
 * between the inventory accounts and the actual stock value as an opening
 * balance (stock that existed before the journal, manual corrections made
 * before stock adjustments were valued).
 */
export async function syncAllJournals(prisma: Prisma.TransactionClient & { $transaction: any }, actorId: string) {
  const sources = await allSources(prisma)
  const unique = [...new Map(sources.map((s) => [`${s.type}:${s.id}`, s])).values()]
  let posted = 0
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10)
    posted += await prisma.$transaction(
      async (tx: Tx) => {
        const book = new AccountBook(tx)
        await book.load()
        let n = 0
        for (const s of batch) if (await syncSource(tx, book, s.type as Exclude<SourceType, "OPENING_BALANCE">, s.id, actorId)) n++
        await checkBalancedNow(tx)
        return n
      },
      { maxWait: 10_000, timeout: 120_000 }
    )
  }
  const opening = await prisma.$transaction(async (tx: Tx) => {
    const done = await postOpeningBalance(tx, actorId)
    await checkBalancedNow(tx)
    return done
  }, { maxWait: 10_000, timeout: 120_000 })
  return { documents: unique.length, posted, openingBalance: opening }
}

/** Inventory accounts vs. actual stock value (warehouses + in transit). */
export async function inventoryReconciliation(tx: Tx) {
  const book = new AccountBook(tx)
  await book.load()
  // Stock value per resolved inventory account (product -> category -> system), one query.
  const stock = await tx.$queryRaw<{ accountId: string; value: Prisma.Decimal }[]>`
    SELECT COALESCE(p."inventoryAccountId", c."inventoryAccountId", ${book.sys("INVENTORY")}) AS "accountId",
           SUM(ROUND(s."quantity" * s."avgCost", 2)) AS value
    FROM "stock" s JOIN "products" p ON p."id" = s."productId" JOIN "categories" c ON c."id" = p."categoryId"
    GROUP BY 1`
  const actual = new Map(stock.map((r) => [r.accountId, new Decimal(r.value)]))
  const transit = await tx.$queryRaw<{ value: Prisma.Decimal | null }[]>`
    SELECT SUM(ROUND(i."unitCost" * (i."dispatchedQuantity" - i."receivedQuantity" - i."lostQuantity" - i."returnedQuantity"), 2)) AS value
    FROM "stock_transfer_items" i JOIN "stock_transfers" t ON t."id" = i."stockTransferId"
    WHERE t."status" IN ('IN_TRANSIT', 'PARTIALLY_RECEIVED')`
  const transitAccount = book.sys("INVENTORY_IN_TRANSIT")
  actual.set(transitAccount, (actual.get(transitAccount) ?? ZERO).plus(transit[0]?.value ?? 0))
  const inventoryAccounts = await tx.account.findMany({ where: { group: "INVENTORY" }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } })
  const balances = await tx.$queryRaw<{ accountId: string; net: Prisma.Decimal }[]>`
    SELECT l."accountId", SUM(l."debit" - l."credit") AS net FROM "journal_lines" l
    JOIN "accounts" a ON a."id" = l."accountId" WHERE a."group" = 'INVENTORY' GROUP BY l."accountId"`
  const ledger = new Map(balances.map((b) => [b.accountId, new Decimal(b.net)]))
  return inventoryAccounts.map((a) => {
    const act = actual.get(a.id) ?? ZERO
    const led = ledger.get(a.id) ?? ZERO
    return { ...a, actual: act, ledger: led, difference: act.minus(led) }
  })
}

async function postOpeningBalance(tx: Tx, actorId: string): Promise<boolean> {
  const done = await tx.journalEntry.count({ where: { sourceType: "OPENING_BALANCE", sourceId: "inventory" } })
  if (done) return false
  const rows = (await inventoryReconciliation(tx)).filter((r) => !r.difference.isZero())
  if (rows.length === 0) return false
  const book = new AccountBook(tx)
  await book.load()
  const total = sumMoney(rows.map((r) => r.difference))
  await tx.journalEntry.create({
    data: {
      entryNumber: await nextDocumentNumber(tx, "JE", "journal_entries", "entryNumber"),
      date: new Date(),
      description: "Opening balance: stock value not covered by earlier journals",
      sourceType: "OPENING_BALANCE",
      sourceId: "inventory",
      userId: actorId,
      lines: {
        create: [
          ...rows.map((r) => ({
            accountId: r.id,
            debit: r.difference.gt(0) ? r.difference : ZERO,
            credit: r.difference.lt(0) ? r.difference.neg() : ZERO,
          })),
          { accountId: book.sys("OPENING_EQUITY"), debit: total.lt(0) ? total.neg() : ZERO, credit: total.gt(0) ? total : ZERO },
        ].filter((l) => !(new Decimal(l.debit).isZero() && new Decimal(l.credit).isZero())),
      },
    },
  })
  return true
}

/** Documents whose posted journal differs from the document now (read-only health check). */
export async function unsyncedCount(tx: Tx): Promise<{ missing: number }> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (
      SELECT 'VALUATION' AS t, "id" FROM "inventory_valuation_entries" WHERE "type"::text IN (${Prisma.join([...POSTED_VALUATION_TYPES])})
      UNION ALL SELECT 'SALES_DELIVERY', "id" FROM "sales_deliveries"
      UNION ALL SELECT 'SALES_RETURN', "id" FROM "sales_returns"
      UNION ALL SELECT 'PURCHASE_RETURN', "id" FROM "purchase_returns"
      UNION ALL SELECT 'CUSTOMER_PAYMENT', "id" FROM "customer_payments"
      UNION ALL SELECT 'SUPPLIER_PAYMENT', "id" FROM "supplier_payments"
      UNION ALL SELECT 'EXPENSE', "id" FROM "expenses"
      UNION ALL SELECT 'LANDED_COST', c."id" FROM "purchase_landed_costs" c JOIN "purchase_orders" po ON po."id" = c."purchaseOrderId" WHERE po."status" <> 'CANCELLED'
      UNION ALL SELECT 'TRANSFER_COST', "id" FROM "stock_transfer_costs"
      UNION ALL SELECT DISTINCT 'PURCHASE_ORDER', "purchaseOrderId" FROM "purchase_receives"
    ) s WHERE NOT EXISTS (SELECT 1 FROM "journal_entries" e WHERE e."sourceType" = s.t AND e."sourceId" = s."id")`
  return { missing: Number(rows[0]?.n ?? 0) }
}

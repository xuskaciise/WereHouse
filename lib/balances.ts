import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { type Money, ZERO, roundMoney, sumMoney } from "@/lib/money"

// Supplier and customer balances, never stored:
//   supplier PAYABLE = the supplier's lines on Accounts Payable in the journal
//                      (received goods with their tax / discount share,
//                      landed and transfer costs owed to them, payments,
//                      purchase return credits and refunds) - so it always
//                      equals the Accounts Payable ledger
//   supplier ORDERED, NOT RECEIVED = value of open purchase orders not yet
//                      received (order total minus the received share)
//   supplier balance   = payable (what is owed now)
//   customer balance = SUM(sales delivery totals) - SUM(customer payments)
//                      - SUM(sales return credit notes) + SUM(refunds paid on returns)
//                      (debt arises at delivery, not when the order is confirmed)

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)))
}

export interface SupplierPosition {
  payable: Money
  orderedNotReceived: Money
}

/** Payable (from the journal) and ordered-not-received value per supplier. */
export async function getSupplierPositions(supplierIds: string[]): Promise<Map<string, SupplierPosition>> {
  const ids = unique(supplierIds)
  const positions = new Map<string, SupplierPosition>(ids.map((id) => [id, { payable: ZERO, orderedNotReceived: ZERO }]))
  if (ids.length === 0) return positions

  const [payables, openOrders] = await Promise.all([
    prisma.$queryRaw<{ supplierId: string; net: Prisma.Decimal }[]>`
      SELECT l."supplierId", SUM(l."credit" - l."debit") AS net
      FROM "journal_lines" l JOIN "accounts" a ON a."id" = l."accountId"
      WHERE a."systemKey" = 'AP' AND l."supplierId" IN (${Prisma.join(ids)})
      GROUP BY l."supplierId"`,
    // Orders not fully received (fully received ones have nothing left).
    prisma.purchaseOrder.findMany({
      where: { supplierId: { in: ids }, status: { in: ["PENDING", "PARTIALLY_RECEIVED"] } },
      select: {
        supplierId: true,
        subtotal: true,
        tax: true,
        discount: true,
        total: true,
        items: { select: { unitPrice: true, receiveItems: { select: { quantityReceived: true } } } },
      },
    }),
  ])
  for (const row of payables) positions.get(row.supplierId)!.payable = new Prisma.Decimal(row.net)
  for (const po of openOrders) {
    positions.get(po.supplierId)!.orderedNotReceived = positions.get(po.supplierId)!.orderedNotReceived.plus(notReceivedValue(po))
  }
  return positions
}

/**
 * Order total minus the received share, computed exactly like the payable of
 * the receipts in lib/accounting.ts, so payable + not received = order total.
 */
export function notReceivedValue(po: {
  subtotal: Money
  tax: Money
  discount: Money
  total: Money
  items: { unitPrice: Money; receiveItems: { quantityReceived: number }[] }[]
}): Money {
  const goods = sumMoney(po.items.map((i) => roundMoney(i.unitPrice.times(i.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)))))
  if (goods.isZero()) return po.total
  if (po.subtotal.isZero() || goods.gte(po.subtotal)) return ZERO
  const share = (v: Money) => roundMoney(v.times(goods).div(po.subtotal))
  return po.total.minus(goods.plus(share(po.tax)).minus(share(po.discount)))
}

/** What is owed to each supplier now (= their Accounts Payable in the journal). */
export async function getSupplierBalances(supplierIds: string[]): Promise<Map<string, Money>> {
  const positions = await getSupplierPositions(supplierIds)
  return new Map([...positions].map(([id, p]) => [id, p.payable]))
}

export async function getCustomerBalances(customerIds: string[]): Promise<Map<string, Money>> {
  const ids = unique(customerIds)
  const balances = new Map<string, Money>(ids.map((id) => [id, ZERO]))
  if (ids.length === 0) return balances

  const [orders, payments, returns] = await Promise.all([
    prisma.$queryRaw<{ customerId: string; total: Prisma.Decimal | null }[]>`
      SELECT so."customerId", SUM(d."total") AS "total"
      FROM "sales_deliveries" d JOIN "sales_orders" so ON so."id" = d."salesOrderId"
      WHERE so."customerId" IN (${Prisma.join(ids)})
      GROUP BY so."customerId"`,
    prisma.customerPayment.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids } },
      _sum: { amount: true },
    }),
    prisma.salesReturn.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids } },
      _sum: { total: true, refundAmount: true },
    }),
  ])

  for (const row of orders) {
    balances.set(row.customerId, (balances.get(row.customerId) ?? ZERO).plus(row.total ?? ZERO))
  }
  for (const row of payments) {
    balances.set(row.customerId, (balances.get(row.customerId) ?? ZERO).minus(row._sum.amount ?? ZERO))
  }
  for (const row of returns) {
    const net = (row._sum.total ?? ZERO).minus(row._sum.refundAmount ?? ZERO)
    balances.set(row.customerId, (balances.get(row.customerId) ?? ZERO).minus(net))
  }
  return balances
}

/** balance = payable (owed now); orderedNotReceived shown separately. */
export async function withSupplierBalance<T extends { id: string }>(suppliers: T[]) {
  const positions = await getSupplierPositions(suppliers.map((s) => s.id))
  return suppliers.map((s) => {
    const p = positions.get(s.id) ?? { payable: ZERO, orderedNotReceived: ZERO }
    return { ...s, balance: p.payable, payable: p.payable, orderedNotReceived: p.orderedNotReceived }
  })
}

export async function withCustomerBalance<T extends { id: string }>(customers: T[]) {
  const balances = await getCustomerBalances(customers.map((c) => c.id))
  return customers.map((c) => ({ ...c, balance: balances.get(c.id) ?? ZERO }))
}

/** Adds `balance` to the nested `supplier` of each row (e.g. payments). */
export async function withNestedSupplierBalance<T extends { supplier: { id: string } }>(rows: T[]) {
  const positions = await getSupplierPositions(rows.map((r) => r.supplier.id))
  return rows.map((r) => {
    const p = positions.get(r.supplier.id) ?? { payable: ZERO, orderedNotReceived: ZERO }
    return { ...r, supplier: { ...r.supplier, balance: p.payable, orderedNotReceived: p.orderedNotReceived } }
  })
}

/** Adds `balance` to the nested `customer` of each row (e.g. payments). */
export async function withNestedCustomerBalance<T extends { customer: { id: string } }>(rows: T[]) {
  const balances = await getCustomerBalances(rows.map((r) => r.customer.id))
  return rows.map((r) => ({ ...r, customer: { ...r.customer, balance: balances.get(r.customer.id) ?? ZERO } }))
}

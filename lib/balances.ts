import { prisma } from "@/lib/prisma"

// Supplier/customer balances are always derived from the source records
// (single source of truth), never stored:
//   supplier balance = SUM(non-cancelled purchase order totals) - SUM(supplier payments)
//   customer balance = SUM(non-cancelled sales order totals)    - SUM(customer payments)
// Each is computed with two grouped aggregate queries, however many rows.

type Amount = { toString(): string } | number | null | undefined

function toNumber(value: Amount): number {
  return value == null ? 0 : Number(value)
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)))
}

export async function getSupplierBalances(supplierIds: string[]): Promise<Map<string, number>> {
  const ids = unique(supplierIds)
  const balances = new Map(ids.map((id) => [id, 0]))
  if (ids.length === 0) return balances

  const [orders, payments] = await Promise.all([
    prisma.purchaseOrder.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: ids }, status: { not: "CANCELLED" } },
      _sum: { total: true },
    }),
    prisma.supplierPayment.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: ids } },
      _sum: { amount: true },
    }),
  ])

  for (const row of orders) {
    balances.set(row.supplierId, (balances.get(row.supplierId) ?? 0) + toNumber(row._sum.total))
  }
  for (const row of payments) {
    balances.set(row.supplierId, (balances.get(row.supplierId) ?? 0) - toNumber(row._sum.amount))
  }
  for (const [id, value] of balances) balances.set(id, Math.round(value * 100) / 100)
  return balances
}

export async function getCustomerBalances(customerIds: string[]): Promise<Map<string, number>> {
  const ids = unique(customerIds)
  const balances = new Map(ids.map((id) => [id, 0]))
  if (ids.length === 0) return balances

  const [orders, payments] = await Promise.all([
    prisma.salesOrder.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, status: { not: "CANCELLED" } },
      _sum: { total: true },
    }),
    prisma.customerPayment.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids } },
      _sum: { amount: true },
    }),
  ])

  for (const row of orders) {
    balances.set(row.customerId, (balances.get(row.customerId) ?? 0) + toNumber(row._sum.total))
  }
  for (const row of payments) {
    balances.set(row.customerId, (balances.get(row.customerId) ?? 0) - toNumber(row._sum.amount))
  }
  for (const [id, value] of balances) balances.set(id, Math.round(value * 100) / 100)
  return balances
}

export async function withSupplierBalance<T extends { id: string }>(suppliers: T[]) {
  const balances = await getSupplierBalances(suppliers.map((s) => s.id))
  return suppliers.map((s) => ({ ...s, balance: balances.get(s.id) ?? 0 }))
}

export async function withCustomerBalance<T extends { id: string }>(customers: T[]) {
  const balances = await getCustomerBalances(customers.map((c) => c.id))
  return customers.map((c) => ({ ...c, balance: balances.get(c.id) ?? 0 }))
}

/** Adds `balance` to the nested `supplier` of each row (e.g. payments). */
export async function withNestedSupplierBalance<T extends { supplier: { id: string } }>(rows: T[]) {
  const balances = await getSupplierBalances(rows.map((r) => r.supplier.id))
  return rows.map((r) => ({ ...r, supplier: { ...r.supplier, balance: balances.get(r.supplier.id) ?? 0 } }))
}

/** Adds `balance` to the nested `customer` of each row (e.g. payments). */
export async function withNestedCustomerBalance<T extends { customer: { id: string } }>(rows: T[]) {
  const balances = await getCustomerBalances(rows.map((r) => r.customer.id))
  return rows.map((r) => ({ ...r, customer: { ...r.customer, balance: balances.get(r.customer.id) ?? 0 } }))
}

import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { scopeWhere } from "@/lib/permissions"
import { ZERO } from "@/lib/money"
import { dateRangeWhere } from "@/lib/pagination"

// Totals per payment method in the period (?from=&to=): received from
// customers, paid to suppliers (incl. landed / transfer costs) and expenses.
export const GET = withAuth(async (request, { user }) => {
  const [received, paid, expenses] = await Promise.all([
    prisma.customerPayment.groupBy({
      by: ["paymentMethod"],
      where: { ...scopeWhere(user, "customer_payments"), ...dateRangeWhere(request, "paymentDate") },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.supplierPayment.groupBy({
      by: ["paymentMethod"],
      where: { ...scopeWhere(user, "supplier_payments"), ...dateRangeWhere(request, "paymentDate") },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.groupBy({
      by: ["paymentMethod"],
      where: { ...scopeWhere(user, "expenses"), ...dateRangeWhere(request, "expenseDate") },
      _sum: { amount: true },
      _count: true,
    }),
  ])

  const rows = new Map<string, { method: string; received: typeof ZERO; paid: typeof ZERO; expenses: typeof ZERO; count: number }>()
  const row = (method: string) => {
    if (!rows.has(method)) rows.set(method, { method, received: ZERO, paid: ZERO, expenses: ZERO, count: 0 })
    return rows.get(method)!
  }
  for (const r of received) Object.assign(row(r.paymentMethod), { received: r._sum.amount ?? ZERO, count: row(r.paymentMethod).count + r._count })
  for (const r of paid) Object.assign(row(r.paymentMethod), { paid: r._sum.amount ?? ZERO, count: row(r.paymentMethod).count + r._count })
  for (const r of expenses) Object.assign(row(r.paymentMethod), { expenses: r._sum.amount ?? ZERO, count: row(r.paymentMethod).count + r._count })

  return json([...rows.values()].sort((a, b) => b.received.plus(b.paid).minus(a.received.plus(a.paid)).toNumber()))
}, { permission: ["reports_finance", "view"] })

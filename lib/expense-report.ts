import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO } from "@/lib/money"
import { type PermissionUser, hasPermission, isOwnScope } from "@/lib/permissions"

// Expense report: totals, averages and breakdowns (category, payment method,
// user, month) for a period and optional filters. All sums are done by the
// database in NUMERIC and returned as Decimal; averages are rounded to cents.

export interface ExpenseReportFilters {
  from: Date
  to: Date
  categoryId?: string
  paymentMethod?: string
  userId?: string
}

function day(value: string | null, name: string, endOfDay: boolean): Date | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`)
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} must be a valid date`)
  return d
}

/** ?from=&to= (default: 1 January of this year to today), ?categoryId, ?paymentMethod, ?userId. */
export function parseExpenseFilters(params: URLSearchParams): ExpenseReportFilters {
  const now = new Date()
  const from = day(params.get("from"), "from", false) ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  const to = day(params.get("to"), "to", true) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  if (from > to) throw new HttpError(400, "from must be before to")
  if (to.getTime() - from.getTime() > 10 * 366 * 86400000) throw new HttpError(400, "The period can be at most 10 years")
  const opt = (k: string) => params.get(k)?.trim() || undefined
  return { from, to, categoryId: opt("categoryId"), paymentMethod: opt("paymentMethod"), userId: opt("userId") }
}

/** OWN scope when the report is opened through an own-data permission. */
function ownOnly(user: PermissionUser): boolean {
  return hasPermission(user, ["reports_finance", "view"]) ? isOwnScope(user, "reports_finance") : isOwnScope(user, "expenses")
}

const avg = (total: Money, n: number) => (n > 0 ? total.div(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : ZERO)

export async function expenseReport(user: PermissionUser, f: ExpenseReportFilters) {
  const own = ownOnly(user)
  const conditions: Prisma.Sql[] = [Prisma.sql`e."expenseDate" >= ${f.from}`, Prisma.sql`e."expenseDate" <= ${f.to}`]
  if (own) conditions.push(Prisma.sql`e."userId" = ${user.id}`)
  if (f.categoryId) conditions.push(Prisma.sql`e."categoryId" = ${f.categoryId}`)
  if (f.paymentMethod) conditions.push(Prisma.sql`e."paymentMethod" = ${f.paymentMethod}`)
  if (f.userId) conditions.push(Prisma.sql`e."userId" = ${f.userId}`)
  const where = Prisma.join(conditions, " AND ")

  type Group = { key: string | null; label: string | null; total: Prisma.Decimal; count: bigint }
  const [summary, byCategory, byMethod, byUser, monthly, rows, categories, users] = await Promise.all([
    prisma.$queryRaw<{ total: Prisma.Decimal | null; count: bigint; largest: Prisma.Decimal | null }[]>`
      SELECT SUM(e."amount") AS total, COUNT(*) AS count, MAX(e."amount") AS largest FROM "expenses" e WHERE ${where}`,
    prisma.$queryRaw<Group[]>`
      SELECT c."id" AS key, c."name" AS label, SUM(e."amount") AS total, COUNT(*) AS count
      FROM "expenses" e JOIN "expense_categories" c ON c."id" = e."categoryId"
      WHERE ${where} GROUP BY c."id", c."name" ORDER BY total DESC`,
    prisma.$queryRaw<Group[]>`
      SELECT e."paymentMethod" AS key, e."paymentMethod" AS label, SUM(e."amount") AS total, COUNT(*) AS count
      FROM "expenses" e WHERE ${where} GROUP BY e."paymentMethod" ORDER BY total DESC`,
    prisma.$queryRaw<Group[]>`
      SELECT u."id" AS key, u."username" AS label, SUM(e."amount") AS total, COUNT(*) AS count
      FROM "expenses" e JOIN "users" u ON u."id" = e."userId"
      WHERE ${where} GROUP BY u."id", u."username" ORDER BY total DESC`,
    prisma.$queryRaw<{ month: string; total: Prisma.Decimal; count: bigint }[]>`
      SELECT to_char(date_trunc('month', e."expenseDate"), 'YYYY-MM') AS month, SUM(e."amount") AS total, COUNT(*) AS count
      FROM "expenses" e WHERE ${where} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      { id: string; expenseDate: Date; description: string; amount: Prisma.Decimal; paymentMethod: string; reference: string | null; category: string; username: string }[]
    >`
      SELECT e."id", e."expenseDate", e."description", e."amount", e."paymentMethod", e."reference",
             c."name" AS category, u."username"
      FROM "expenses" e
      JOIN "expense_categories" c ON c."id" = e."categoryId"
      JOIN "users" u ON u."id" = e."userId"
      WHERE ${where} ORDER BY e."expenseDate" DESC, e."createdAt" DESC LIMIT 2000`,
    prisma.expenseCategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Filter options: people who recorded expenses (only yourself in OWN scope).
    own
      ? prisma.user.findMany({ where: { id: user.id }, select: { id: true, username: true } })
      : prisma.user.findMany({ where: { expenses: { some: {} } }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
  ])

  const total = summary[0]?.total ?? ZERO
  const count = Number(summary[0]?.count ?? 0)

  // Every month of the period, also those without expenses (continuous trend).
  const months: string[] = []
  const cursor = new Date(Date.UTC(f.from.getUTCFullYear(), f.from.getUTCMonth(), 1))
  while (cursor <= f.to && months.length < 120) {
    months.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  const byMonth = new Map(monthly.map((m) => [m.month, m]))
  const share = (value: Money) => (total.isZero() ? ZERO : value.times(100).div(total).toDecimalPlaces(1, Decimal.ROUND_HALF_UP))
  const group = (rows: Group[]) =>
    rows.map((r) => ({ key: r.key, label: r.label, total: r.total, count: Number(r.count), share: share(r.total) }))

  return {
    period: { from: f.from, to: f.to },
    scope: own ? "OWN" : "ALL",
    totals: {
      total,
      count,
      averagePerExpense: avg(total, count),
      months: months.length,
      averagePerMonth: avg(total, months.length),
      largest: summary[0]?.largest ?? ZERO,
    },
    byCategory: group(byCategory),
    byPaymentMethod: group(byMethod),
    byUser: group(byUser),
    monthly: months.map((month) => ({
      month,
      total: byMonth.get(month)?.total ?? ZERO,
      count: Number(byMonth.get(month)?.count ?? 0),
    })),
    rows,
    rowsTruncated: rows.length >= 2000,
    options: { categories, users },
  }
}

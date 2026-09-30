import { type AccountGroup, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, sumMoney } from "@/lib/money"
import { type PermissionUser, isOwnScope } from "@/lib/permissions"

// Profit & Loss built from the journal (lib/accounting.ts), for any period,
// compared with the previous period of the same length:
//   Sales (credit - debit of SALES accounts)
//   - Sales returns                             = Net sales
//   - Cost of goods sold                        = Gross profit (margin %)
//   + Other income (e.g. purchase discounts)
//   - Operating expenses (one line per expense account = expense category)
//   - Losses (transit losses, damaged returns, stock corrections, return differences)
//   - Other expenses (e.g. purchase tax)         = Net profit
// Every amount is a NUMERIC sum from the database, returned as Decimal.

const DAY = 86400000

function day(value: string | null, name: string, endOfDay: boolean): Date | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`)
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
}

/** ?from=&to= (default: this month); the comparison is the equally long period just before. */
export function parsePeriod(params: URLSearchParams) {
  const now = new Date()
  const from = day(params.get("from"), "from", false) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = day(params.get("to"), "to", true) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  if (from > to) throw new HttpError(400, "from must be before to")
  const days = Math.round((to.getTime() + 1 - from.getTime()) / DAY)
  const previousTo = new Date(from.getTime() - 1)
  const previousFrom = new Date(from.getTime() - days * DAY)
  return { from, to, previousFrom, previousTo, days }
}

type Row = { accountId: string; code: string; name: string; group: AccountGroup; current: Money; previous: Money }

const SECTIONS: { key: string; label: string; groups: AccountGroup[]; sign: 1 | -1 }[] = [
  { key: "sales", label: "Sales", groups: ["SALES"], sign: 1 },
  { key: "salesReturns", label: "Sales returns", groups: ["SALES_RETURNS"], sign: -1 },
  { key: "cogs", label: "Cost of goods sold", groups: ["COGS"], sign: -1 },
  { key: "otherIncome", label: "Other income", groups: ["OTHER_INCOME"], sign: 1 },
  { key: "operatingExpenses", label: "Operating expenses", groups: ["OPERATING_EXPENSE"], sign: -1 },
  { key: "losses", label: "Losses", groups: ["LOSS"], sign: -1 },
  { key: "otherExpenses", label: "Other expenses", groups: ["OTHER_EXPENSE"], sign: -1 },
]

const change = (current: Money, previous: Money) => ({
  change: current.minus(previous),
  changePercent: previous.isZero() ? null : current.minus(previous).times(100).div(previous.abs()).toDecimalPlaces(1, Decimal.ROUND_HALF_UP),
})

export async function profitAndLoss(user: PermissionUser, period: ReturnType<typeof parsePeriod>) {
  const own = isOwnScope(user, "reports_finance") ? Prisma.sql`AND e."userId" = ${user.id}` : Prisma.empty
  // Income / expense accounts: amount as credit - debit (income positive, expense negative).
  const rows = await prisma.$queryRaw<{ accountId: string; code: string; name: string; group: AccountGroup; current: Prisma.Decimal; previous: Prisma.Decimal }[]>`
    SELECT a."id" AS "accountId", a."code", a."name", a."group",
      COALESCE(SUM(l."credit" - l."debit") FILTER (WHERE e."date" BETWEEN ${period.from} AND ${period.to}), 0) AS current,
      COALESCE(SUM(l."credit" - l."debit") FILTER (WHERE e."date" BETWEEN ${period.previousFrom} AND ${period.previousTo}), 0) AS previous
    FROM "journal_lines" l
    JOIN "journal_entries" e ON e."id" = l."entryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE a."type" IN ('INCOME', 'EXPENSE') AND e."date" BETWEEN ${period.previousFrom} AND ${period.to} ${own}
    GROUP BY a."id", a."code", a."name", a."group"
    ORDER BY a."code"`

  const sections = SECTIONS.map((s) => {
    // Shown as positive amounts in their section; the sign says add or subtract.
    const lines: (Row & ReturnType<typeof change>)[] = rows
      .filter((r) => s.groups.includes(r.group))
      .map((r) => ({ ...r, current: new Decimal(r.current).times(s.sign), previous: new Decimal(r.previous).times(s.sign) }))
      .filter((r) => !r.current.isZero() || !r.previous.isZero())
      .map((r) => ({ ...r, ...change(r.current, r.previous) }))
    const current = sumMoney(lines.map((l) => l.current))
    const previous = sumMoney(lines.map((l) => l.previous))
    return { key: s.key, label: s.label, sign: s.sign, lines, current, previous, ...change(current, previous) }
  })
  const get = (key: string) => sections.find((s) => s.key === key)!
  const total = (pick: (s: { current: Money; previous: Money }) => Money, keys: [string, 1 | -1][]) =>
    keys.reduce((sum, [k, sign]) => sum.plus(pick(get(k)).times(sign)), ZERO)
  const both = (keys: [string, 1 | -1][]) => {
    const current = total((s) => s.current, keys)
    const previous = total((s) => s.previous, keys)
    return { current, previous, ...change(current, previous) }
  }
  const netSales = both([["sales", 1], ["salesReturns", -1]])
  const grossProfit = both([["sales", 1], ["salesReturns", -1], ["cogs", -1]])
  const netProfit = both([
    ["sales", 1],
    ["salesReturns", -1],
    ["cogs", -1],
    ["otherIncome", 1],
    ["operatingExpenses", -1],
    ["losses", -1],
    ["otherExpenses", -1],
  ])
  const margin = (profit: Money, sales: Money) => (sales.isZero() ? null : profit.times(100).div(sales).toDecimalPlaces(1, Decimal.ROUND_HALF_UP))
  return {
    period: { from: period.from, to: period.to, days: period.days },
    previousPeriod: { from: period.previousFrom, to: period.previousTo },
    scope: own === Prisma.empty ? "ALL" : "OWN",
    sections,
    totals: {
      netSales,
      grossProfit,
      grossMargin: { current: margin(grossProfit.current, netSales.current), previous: margin(grossProfit.previous, netSales.previous) },
      netProfit,
      netMargin: { current: margin(netProfit.current, netSales.current), previous: margin(netProfit.previous, netSales.previous) },
    },
  }
}

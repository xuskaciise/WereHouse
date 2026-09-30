// Task 13 integration test (Profit & Loss from the journal) on the DEV database.
import { prisma, TX_OPTIONS } from "@/lib/prisma"
import { postAccounting } from "@/lib/accounting"
import { createExpenseAccountFor } from "@/lib/accounts"
import { parsePeriod, profitAndLoss } from "@/lib/profit-loss"
import type { Prisma } from "@prisma/client"
import { assertDevDatabase, check, eq, expectError, finish, testUser } from "./helpers"

async function main() {
  assertDevDatabase()
  const tag = "t13" + Date.now().toString(36)
  const admin = await testUser("t13_admin", "ADMIN")
  const student = await testUser("t13_student", "STUDENT")
  const p = (q: Record<string, string>) => parsePeriod(new URLSearchParams(q))

  // Previous period = same number of days just before.
  const feb = p({ from: "2024-02-01", to: "2024-02-29" })
  check("period of 29 days", feb.days === 29, feb.days)
  check("previous period 2024-01-03 .. 2024-01-31", feb.previousFrom.toISOString().slice(0, 10) === "2024-01-03" && feb.previousTo.toISOString().slice(0, 10) === "2024-01-31", [feb.previousFrom, feb.previousTo])
  await expectError("from after to", async () => p({ from: "2024-03-01", to: "2024-02-01" }), 400)

  // Backdated expenses land in their own period and expense account (journal date = expense date).
  const cat = await prisma.expenseCategory.create({ data: { name: `Rent ${tag}`, nameKey: `rent ${tag}` } })
  await prisma.$transaction((tx) => createExpenseAccountFor(tx, cat.id, cat.name), TX_OPTIONS)
  const accountId = (await prisma.expenseCategory.findUniqueOrThrow({ where: { id: cat.id } })).accountId!
  const before = await profitAndLoss(admin, feb)
  const beforeOpex = before.sections.find((s) => s.key === "operatingExpenses")!.current
  const beforeNet = before.totals.netProfit.current
  await prisma.$transaction(async (tx) => {
    await tx.expense.create({ data: { categoryId: cat.id, amount: "150.50", description: tag, expenseDate: new Date("2024-02-10T09:00:00Z"), paymentMethod: "CASH", userId: admin.id } })
    await tx.expense.create({ data: { categoryId: cat.id, amount: "20", description: tag, expenseDate: new Date("2024-01-20T09:00:00Z"), paymentMethod: "CASH", userId: student.id } })
    await postAccounting(tx, {}, admin.id)
  }, TX_OPTIONS)

  const r = await profitAndLoss(admin, feb)
  const opex = r.sections.find((s) => s.key === "operatingExpenses")!
  const line = opex.lines.find((l) => l.accountId === accountId)!
  check("expense account line: current 150.50, previous 20", eq(line.current, "150.5") && eq(line.previous, 20), line)
  check("change 130.50 and +652.5%", eq(line.change, "130.5") && eq(line.changePercent!, "652.5"), line)
  check("operating expenses grew by 150.50", eq(opex.current.minus(beforeOpex), "150.5"), [opex.current, beforeOpex])
  check("net profit fell by 150.50", eq(beforeNet.minus(r.totals.netProfit.current), "150.5"), [beforeNet, r.totals.netProfit.current])

  // Totals follow the statement formula for any period (today, with the dev test data).
  const today = new Date().toISOString().slice(0, 10)
  for (const [label, range] of [["february 2024", feb], ["today", p({ from: today, to: today })], ["this year", p({ from: `${today.slice(0, 4)}-01-01`, to: today })]] as const) {
    const x = await profitAndLoss(admin, range)
    const s = (k: string) => x.sections.find((y) => y.key === k)!.current
    const net = s("sales").minus(s("salesReturns")).minus(s("cogs")).plus(s("otherIncome")).minus(s("operatingExpenses")).minus(s("losses")).minus(s("otherExpenses"))
    check(`${label}: net profit = statement formula`, eq(net, x.totals.netProfit.current), [net, x.totals.netProfit.current])
    check(`${label}: gross profit = net sales - COGS`, eq(x.totals.grossProfit.current, x.totals.netSales.current.minus(s("cogs"))))
    // Independent check: net profit = credit - debit of all income and expense accounts in the period.
    const raw = await prisma.$queryRaw<{ n: Prisma.Decimal | null }[]>`
      SELECT SUM(l."credit" - l."debit") AS n FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
      JOIN "accounts" a ON a."id" = l."accountId" WHERE a."type" IN ('INCOME', 'EXPENSE') AND e."date" BETWEEN ${range.from} AND ${range.to}`
    check(`${label}: net profit = journal income - expenses`, eq(raw[0].n ?? 0, x.totals.netProfit.current), [raw[0].n, x.totals.netProfit.current])
  }

  // OWN scope (student): only their own entries.
  const own = await profitAndLoss(student, p({ from: "2024-01-01", to: "2024-01-31" }))
  const ownLine = own.sections.find((s) => s.key === "operatingExpenses")!.lines.find((l) => l.accountId === accountId)
  check("student sees only own expense (20)", own.scope === "OWN" && !!ownLine && eq(ownLine.current, 20), ownLine)
  finish()
}

main().finally(() => prisma.$disconnect())

// Task 11 integration test (expense reports) on the DEV database.
import { prisma } from "@/lib/prisma"
import { expenseReport, parseExpenseFilters } from "@/lib/expense-report"
import { assertDevDatabase, check, eq, expectError, finish, testUser } from "./helpers"

async function main() {
  assertDevDatabase()
  const tag = "t11" + Date.now().toString(36)
  const admin = await testUser("t11_admin", "ADMIN")
  const student = await testUser("t11_student", "STUDENT")
  const cat = await prisma.expenseCategory.create({ data: { name: `Rent ${tag}`, nameKey: `rent ${tag}` } })
  const cat2 = await prisma.expenseCategory.create({ data: { name: `Fuel ${tag}`, nameKey: `fuel ${tag}` } })
  const mk = (categoryId: string, amount: string, date: string, paymentMethod: string, userId: string) =>
    prisma.expense.create({ data: { categoryId, amount, description: `e ${tag}`, expenseDate: new Date(`${date}T10:00:00Z`), paymentMethod, userId } })
  await mk(cat.id, "100.10", "2025-01-15", "CASH", admin.id)
  await mk(cat.id, "200.20", "2025-03-02", "EVC_PLUS", admin.id)
  await mk(cat2.id, "50.05", "2025-03-20", "CASH", student.id)
  await mk(cat2.id, "0.01", "2025-04-30", "ZAAD", admin.id)

  const params = (q: Record<string, string>) => new URLSearchParams(q)
  const r = await expenseReport(admin, parseExpenseFilters(params({ from: "2025-01-01", to: "2025-04-30", categoryId: cat.id })))
  check("category filter: total 300.30", eq(r.totals.total, "300.3"), r.totals)
  check("count 2", r.totals.count === 2, r.totals.count)
  check("average per expense 150.15", eq(r.totals.averagePerExpense, "150.15"), r.totals.averagePerExpense)
  check("4 months incl. empty ones", r.totals.months === 4 && r.monthly.map((m) => m.month).join() === "2025-01,2025-02,2025-03,2025-04", r.monthly)
  check("average per month 75.08", eq(r.totals.averagePerMonth, "75.08"), r.totals.averagePerMonth)
  check("empty month is 0", eq(r.monthly[1].total, 0) && r.monthly[1].count === 0, r.monthly[1])
  check("largest 200.20", eq(r.totals.largest, "200.2"), r.totals.largest)

  // Our two categories only (other dev data may exist in the period).
  const both = await Promise.all([cat.id, cat2.id].map((id) => expenseReport(admin, parseExpenseFilters(params({ from: "2025-01-01", to: "2025-12-31", categoryId: id })))))
  const cash = both.flatMap((x) => x.byPaymentMethod).filter((m) => m.key === "CASH")
  check("by method: CASH 100.10 + 50.05", eq(cash.reduce((s, m) => s.plus(m.total), cash[0].total.minus(cash[0].total)), "150.15"), cash)
  const r2 = both[1]
  check("share % adds to 100", eq(r2.byPaymentMethod.reduce((s, m) => s.plus(m.share), r2.byPaymentMethod[0].share.minus(r2.byPaymentMethod[0].share)), 100), r2.byPaymentMethod)
  check("by user: student 50.05", eq(r2.byUser.find((u) => u.key === student.id)!.total, "50.05"), r2.byUser)

  const own = await expenseReport(student, parseExpenseFilters(params({ from: "2025-01-01", to: "2025-12-31", categoryId: cat2.id })))
  check("student (OWN) sees only own expenses", own.scope === "OWN" && own.totals.count === 1 && eq(own.totals.total, "50.05"), own.totals)
  const method = await expenseReport(admin, parseExpenseFilters(params({ from: "2025-01-01", to: "2025-12-31", categoryId: cat2.id, paymentMethod: "ZAAD" })))
  check("payment method filter", method.totals.count === 1 && eq(method.totals.total, "0.01"), method.totals)

  await expectError("invalid date", async () => parseExpenseFilters(params({ from: "2025-13-01" })), 400)
  await expectError("from after to", async () => parseExpenseFilters(params({ from: "2025-05-01", to: "2025-01-01" })), 400)
  finish()
}

main().finally(() => prisma.$disconnect())

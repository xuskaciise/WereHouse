import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { listResponse } from "@/lib/pagination"
import { createExpenseCategory, expenseCategorySelect, parseExpenseCategoryInput } from "@/lib/expense-categories"
import { parseExpenseAccountLink } from "@/lib/accounts"

// Expense categories are shared reference data: anyone who records or views
// expenses sees all of them; managing them needs the expense_categories module.
// ?active=true returns only categories that can be chosen for new expenses.
export const GET = withAuth(async (request) => {
  const where = new URL(request.url).searchParams.get("active") === "true" ? { isActive: true } : {}
  return listResponse(request, {
    findMany: (page) =>
      prisma.expenseCategory.findMany({
        where,
        select: expenseCategorySelect,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        ...page,
      }),
    count: () => prisma.expenseCategory.count({ where }),
  })
}, { permission: [["expenses", "view"], ["expense_categories", "view"]] })

export const POST = withAuth(
  async (request, { user }) => {
    const body = await readJson(request)
    const input = parseExpenseCategoryInput(body)
    const { accountId } = await parseExpenseAccountLink(user, body)
    const category = await createExpenseCategory(input, user.id, accountId)
    return json(category, { status: 201 })
  },
  { permission: ["expense_categories", "create"] }
)

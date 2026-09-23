import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { listResponse } from "@/lib/pagination"
import { EXPENSE_CATEGORY_MANAGER_ROLES } from "@/lib/expense-rules"
import { createExpenseCategory, expenseCategorySelect, parseExpenseCategoryInput } from "@/lib/expense-categories"

// Expense categories are shared reference data: every signed-in user sees
// all of them (to record expenses); only ADMIN/ACCOUNTANT manage them.
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
})

export const POST = withAuth(
  async (request, { user }) => {
    const input = parseExpenseCategoryInput(await readJson(request))
    const category = await createExpenseCategory(input, user.id)
    return json(category, { status: 201 })
  },
  { roles: EXPENSE_CATEGORY_MANAGER_ROLES }
)

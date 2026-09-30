import { json, readJson, withAuth } from "@/lib/api"
import { deleteExpenseCategory, parseExpenseCategoryInput, updateExpenseCategory } from "@/lib/expense-categories"
import { parseExpenseAccountLink } from "@/lib/accounts"

// Rename, change the description, or (de)activate a category.
export const PATCH = withAuth<{ id: string }>(
  async (request, { user, params }) => {
    const body = await readJson(request)
    const input = parseExpenseCategoryInput(body, { partial: true })
    // Expense account of the category (accounting:edit only).
    const { accountId } = await parseExpenseAccountLink(user, body)
    return json(await updateExpenseCategory(params.id, input, accountId))
  },
  { permission: ["expense_categories", "edit"] }
)

// Only unused categories can be deleted (409 otherwise).
export const DELETE = withAuth<{ id: string }>(
  async (_request, { params }) => {
    await deleteExpenseCategory(params.id)
    return json({ success: true })
  },
  { permission: ["expense_categories", "delete"] }
)

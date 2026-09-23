import { json, readJson, withAuth } from "@/lib/api"
import { deleteExpenseCategory, parseExpenseCategoryInput, updateExpenseCategory } from "@/lib/expense-categories"

// Rename, change the description, or (de)activate a category.
export const PATCH = withAuth<{ id: string }>(
  async (request, { params }) => {
    const input = parseExpenseCategoryInput(await readJson(request), { partial: true })
    return json(await updateExpenseCategory(params.id, input))
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

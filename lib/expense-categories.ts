import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withConflictMessages } from "@/lib/api"
import { HttpError } from "@/lib/http-error"
import { EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH, EXPENSE_CATEGORY_NAME_MAX_LENGTH } from "@/lib/expense-rules"

export const expenseCategorySelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { expenses: true } },
} satisfies Prisma.ExpenseCategorySelect

export interface ExpenseCategoryInput {
  name?: string
  description?: string | null
  isActive?: boolean
}

/** Case-insensitive uniqueness key, stored in nameKey (unique index). */
export function expenseCategoryNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Validates a create (all required fields) or update (`partial`) body.
 * Names are trimmed and inner whitespace collapsed.
 */
export function parseExpenseCategoryInput(body: any, { partial = false } = {}): ExpenseCategoryInput {
  const input: ExpenseCategoryInput = {}

  if (!partial || body?.name !== undefined) {
    const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : ""
    if (!name) throw new HttpError(400, "Category name is required")
    if (name.length > EXPENSE_CATEGORY_NAME_MAX_LENGTH) {
      throw new HttpError(400, `Category name must be at most ${EXPENSE_CATEGORY_NAME_MAX_LENGTH} characters`)
    }
    input.name = name
  }

  if (body?.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new HttpError(400, "Description must be text")
    }
    const description = (body.description ?? "").trim()
    if (description.length > EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH) {
      throw new HttpError(400, `Description must be at most ${EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH} characters`)
    }
    input.description = description || null
  }

  if (body?.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false")
    input.isActive = body.isActive
  }

  if (partial && Object.keys(input).length === 0) throw new HttpError(400, "Nothing to update")
  return input
}

function duplicateMessage(name: string) {
  return `An expense category named "${name}" already exists (names are not case-sensitive)`
}

export async function createExpenseCategory(input: ExpenseCategoryInput, userId: string) {
  const name = input.name!
  return withConflictMessages(
    () =>
      prisma.expenseCategory.create({
        data: {
          name,
          nameKey: expenseCategoryNameKey(name),
          description: input.description ?? null,
          isActive: input.isActive ?? true,
          userId,
        },
        select: expenseCategorySelect,
      }),
    { unique: duplicateMessage(name) }
  )
}

export async function updateExpenseCategory(id: string, input: ExpenseCategoryInput) {
  return withConflictMessages(
    () =>
      prisma.expenseCategory.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name, nameKey: expenseCategoryNameKey(input.name) }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
        select: expenseCategorySelect,
      }),
    { unique: duplicateMessage(input.name ?? "") }
  )
}

/**
 * Deletes a category only when no expense uses it. Expenses are never
 * deleted (the foreign key is RESTRICT as a second line of defence).
 */
export async function deleteExpenseCategory(id: string): Promise<void> {
  const category = await prisma.expenseCategory.findUnique({
    where: { id },
    select: { name: true, _count: { select: { expenses: true } } },
  })
  if (!category) throw new HttpError(404, "Expense category not found")
  const used = category._count.expenses
  if (used > 0) {
    throw new HttpError(
      409,
      `"${category.name}" is used by ${used} expense${used === 1 ? "" : "s"} and cannot be deleted. Deactivate it instead to hide it from new expenses.`
    )
  }
  await withConflictMessages(() => prisma.expenseCategory.delete({ where: { id } }), {
    inUse: `"${category.name}" is used by expenses and cannot be deleted. Deactivate it instead.`,
  })
}

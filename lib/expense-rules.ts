import type { Role } from "@prisma/client"

// Shared by the API and the UI (no server-only imports). The server enforces
// these; the UI only hides what the user cannot do.

/** Roles allowed to create, edit, deactivate or delete expense categories. */
export const EXPENSE_CATEGORY_MANAGER_ROLES: Role[] = ["ADMIN", "ACCOUNTANT"]

export function canManageExpenseCategories(role: Role): boolean {
  return EXPENSE_CATEGORY_MANAGER_ROLES.includes(role)
}

export const EXPENSE_CATEGORY_NAME_MAX_LENGTH = 100
export const EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH = 500

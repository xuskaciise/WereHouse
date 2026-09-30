import { json, readJson, withAuth } from "@/lib/api"
import { createAccount, listAccounts } from "@/lib/accounts"

// Chart of accounts with debit / credit totals and balance per account.
export const GET = withAuth(async (_request, { user }) => json(await listAccounts(user)), {
  // Also a lookup for the account selects on categories / products / expense categories.
  permission: [["accounting", "view"], ["categories", "edit"], ["products", "edit"], ["expense_categories", "edit"]],
})

// Body: { code, name, type, group, description? }.
export const POST = withAuth(async (request) => json(await createAccount(await readJson(request)), { status: 201 }), {
  permission: ["accounting", "edit"],
})

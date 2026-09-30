import { json, withAuth } from "@/lib/api"
import { expenseReport, parseExpenseFilters } from "@/lib/expense-report"

// Expense report: ?from=&to= (YYYY-MM-DD, default this year), ?categoryId,
// ?paymentMethod, ?userId. Finance reports see all expenses; roles that only
// have expenses (OWN scope) see their own.
export const GET = withAuth(async (request, { user }) => {
  return json(await expenseReport(user, parseExpenseFilters(new URL(request.url).searchParams)))
}, { permission: [["reports_finance", "view"], ["expenses", "view"]] })

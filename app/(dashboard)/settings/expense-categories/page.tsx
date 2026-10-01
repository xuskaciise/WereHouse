import { requirePageAccess } from "@/lib/page-access"
import { ExpensesView } from "../../expenses/expenses-view"

export default async function Page() {
  await requirePageAccess("/settings/expense-categories")
  return <ExpensesView categoriesOnly />
}

import { json, withAuth } from "@/lib/api"
import { accountLedger, periodOf } from "@/lib/accounts"

// Account ledger: opening balance, lines with running balance, closing balance. ?from=&to=
export const GET = withAuth<{ id: string }>(async (request, { user, params }) => {
  const { from, to } = periodOf(new URL(request.url).searchParams)
  return json(await accountLedger(user, params.id, from, to))
}, { permission: ["accounting", "view"] })

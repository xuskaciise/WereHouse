import { json, withAuth } from "@/lib/api"
import { periodOf, trialBalance } from "@/lib/accounts"

// Trial balance for ?from=&to= (both optional): debits always equal credits.
export const GET = withAuth(async (request, { user }) => {
  const { from, to } = periodOf(new URL(request.url).searchParams)
  return json(await trialBalance(user, from, to))
}, { permission: ["accounting", "view"] })

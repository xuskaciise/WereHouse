import { json, withAuth } from "@/lib/api"
import { isOwnScope } from "@/lib/permissions"
import { inTransitStock } from "@/lib/stock-transfers"

// Goods dispatched but not yet received, lost or returned (for the stock
// page): counted in neither warehouse. Values are removed for roles without
// product_cost (lib/api.ts).
export const GET = withAuth(async (_request, { user }) => {
  return json(await inTransitStock(isOwnScope(user, "stock_transfers") ? { userId: user.id } : {}))
}, { permission: [["stock_transfers", "view"], ["stock", "view"]] })

import { json, withAuth } from "@/lib/api"
import { getCompanyProfile, walkInCustomerId } from "@/lib/company"
import { hasPermission } from "@/lib/permissions"

// Company details for printed documents; the walk-in customer id for roles that sell.
export const GET = withAuth(async (_request, { user }) => {
  const profile = await getCompanyProfile()
  const sells = hasPermission(user, ["sales", "create"])
  return json({ ...profile, ...(sells && { walkInCustomerId: await walkInCustomerId() }) })
}, { authenticatedOnly: true })

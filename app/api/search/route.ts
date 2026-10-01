import { json, withAuth } from "@/lib/api"
import { globalSearch } from "@/lib/search"

// ?q= (2+ characters): products, customers, suppliers and document numbers the user may see.
export const GET = withAuth(async (request, { user }) => json(await globalSearch(user, new URL(request.url).searchParams.get("q") ?? "")), {
  authenticatedOnly: true,
})

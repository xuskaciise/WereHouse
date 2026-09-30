import { json, withAuth } from "@/lib/api"
import { listJournal } from "@/lib/accounts"

// Journal entries with their lines: ?from=&to=&sourceType=&q=&page=
export const GET = withAuth(async (request, { user }) => json(await listJournal(user, new URL(request.url).searchParams)), {
  permission: ["accounting", "view"],
})

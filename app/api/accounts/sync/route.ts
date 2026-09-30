import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { inventoryReconciliation, syncAllJournals, unsyncedCount } from "@/lib/accounting"

// Health of the journal: documents without a journal, inventory accounts vs. stock value.
export const GET = withAuth(async () => {
  const [unsynced, inventory] = await Promise.all([
    prisma.$transaction((tx) => unsyncedCount(tx)),
    prisma.$transaction((tx) => inventoryReconciliation(tx)),
  ])
  return json({ ...unsynced, inventory })
}, { permission: ["accounting", "view"] })

// Backfill / repair (ADMIN): posts the journal of every document that has
// none or differs from the document, then once the opening stock balance.
// Idempotent: running it again posts nothing new.
export const POST = withAuth(async (_request, { user }) => json(await syncAllJournals(prisma as any, user.id)), { roles: ["ADMIN"] })

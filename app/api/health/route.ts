import { prisma } from "@/lib/prisma"
import { json, publicRoute } from "@/lib/api"

// Used by the deploy health check: confirms the app is up and can reach the
// database. Reveals nothing beyond "ok".
export const GET = publicRoute(async () => {
  await prisma.$queryRaw`SELECT 1`
  return json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } })
})

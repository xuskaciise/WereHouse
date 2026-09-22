import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"

// Approves every PENDING or REJECTED user. ADMIN-only.
export const POST = withAuth(
  async () => {
    const result = await prisma.user.updateMany({
      where: { status: { in: ["PENDING", "REJECTED"] } },
      data: { status: "APPROVED" },
    })
    return json({ success: true, count: result.count })
  },
  { roles: ["ADMIN"] }
)

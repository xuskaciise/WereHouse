import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"

// Rejects every PENDING or APPROVED non-admin user. ADMIN-only. Admin
// accounts are excluded so this can never lock every administrator out.
export const POST = withAuth(
  async () => {
    const result = await prisma.user.updateMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        role: { not: "ADMIN" },
      },
      data: { status: "REJECTED" },
    })
    return json({ success: true, count: result.count })
  },
  { roles: ["ADMIN"] }
)

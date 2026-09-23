import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { scopeWhere } from "@/lib/permissions"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = scopeWhere(user, "stock")
  return listResponse(request, {
    findMany: (page) =>
      prisma.stock.findMany({
        where,
        include: { product: true, warehouse: true },
        orderBy: { updatedAt: "desc" },
        ...page,
      }),
    count: () => prisma.stock.count({ where }),
  })
}, { permission: ["stock", "view"] })

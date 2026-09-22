import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { ownershipWhere } from "@/lib/auth-guard"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = ownershipWhere(user)
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
})

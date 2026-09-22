import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { ownershipWhere } from "@/lib/auth-guard"

export const GET = withAuth(async (request, { user: currentUser }) => {
  try {
    const stock = await prisma.stock.findMany({
      where: ownershipWhere(currentUser),
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    })
    return NextResponse.json(stock)
  } catch (error) {
    console.error("Error fetching stock:", error)
    return NextResponse.json(
      { error: "Failed to fetch stock" },
      { status: 500 }
    )
  }
})

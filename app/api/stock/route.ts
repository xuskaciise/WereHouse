import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser, ownershipWhere } from "@/lib/rbac"

export async function GET(request: Request) {
  try {
    const currentUser = await getRequestUser(request)
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
}

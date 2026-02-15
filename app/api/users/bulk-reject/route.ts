import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST() {
  try {
    // Reject both PENDING and APPROVED users
    // First check how many users can be rejected
    const pendingCount = await prisma.user.count({
      where: {
        status: "PENDING",
      },
    })
    
    const approvedCount = await prisma.user.count({
      where: {
        status: "APPROVED",
      },
    })
    
    const totalCount = pendingCount + approvedCount
    console.log("Users to reject - PENDING:", pendingCount, "APPROVED:", approvedCount, "Total:", totalCount)
    
    if (totalCount === 0) {
      return NextResponse.json({ success: true, count: 0 })
    }

    // Try Prisma updateMany first
    let result
    try {
      console.log("Attempting Prisma updateMany for bulk reject")
      result = await prisma.user.updateMany({
        where: {
          status: {
            in: ["PENDING", "APPROVED"],
          },
        },
        data: {
          status: "REJECTED",
        },
      })
      console.log("Prisma updateMany succeeded:", result)
    } catch (prismaError: any) {
      console.error("Prisma updateMany failed:", prismaError)
      console.error("Error message:", prismaError.message)
      console.error("Error code:", prismaError.code)
      
      // If status field is not recognized, use raw SQL
      if (prismaError.message?.includes("status") || 
          prismaError.message?.includes("Unknown argument") || 
          prismaError.code === "P2009" ||
          prismaError.message?.includes("does not exist")) {
        console.log("Using raw SQL for bulk reject")
        try {
          const countResult: any = await prisma.$executeRawUnsafe(`
            UPDATE users 
            SET status = 'REJECTED'::"UserStatus"
            WHERE status IN ('PENDING'::"UserStatus", 'APPROVED'::"UserStatus")
          `)
          result = { count: Number(countResult) || 0 }
          console.log("Raw SQL succeeded, count:", result.count)
        } catch (sqlError: any) {
          console.error("Raw SQL also failed:", sqlError)
          throw sqlError
        }
      } else {
        throw prismaError
      }
    }

    return NextResponse.json({ success: true, count: result.count || 0 })
  } catch (error: any) {
    console.error("Error rejecting users:", error)
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      meta: error.meta,
    })
    return NextResponse.json(
      { success: false, error: error.message || "Failed to reject users" },
      { status: 500 }
    )
  }
}

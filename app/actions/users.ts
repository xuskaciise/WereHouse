"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

export async function bulkApproveUsers() {
  try {
    // First check how many pending users exist
    const pendingCount = await prisma.user.count({
      where: {
        status: "PENDING",
      },
    })
    
    console.log("Pending users count:", pendingCount)
    
    if (pendingCount === 0) {
      return { success: true, count: 0 }
    }

    // Try Prisma updateMany first
    let result
    try {
      console.log("Attempting Prisma updateMany for bulk approve")
      result = await prisma.user.updateMany({
        where: {
          status: "PENDING",
        },
        data: {
          status: "APPROVED",
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
        console.log("Using raw SQL for bulk approve")
        try {
          const countResult: any = await prisma.$executeRawUnsafe(`
            UPDATE users 
            SET status = 'APPROVED'::"UserStatus"
            WHERE status = 'PENDING'::"UserStatus"
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

    revalidatePath("/users")
    return { success: true, count: result.count || 0 }
  } catch (error: any) {
    console.error("Error approving users:", error)
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      meta: error.meta,
    })
    return { success: false, error: error.message || "Failed to approve users" }
  }
}

export async function bulkRejectUsers() {
  try {
    // First check how many pending users exist
    const pendingCount = await prisma.user.count({
      where: {
        status: "PENDING",
      },
    })
    
    console.log("Pending users count:", pendingCount)
    
    if (pendingCount === 0) {
      return { success: true, count: 0 }
    }

    // Try Prisma updateMany first
    let result
    try {
      console.log("Attempting Prisma updateMany for bulk reject")
      result = await prisma.user.updateMany({
        where: {
          status: "PENDING",
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
            WHERE status = 'PENDING'::"UserStatus"
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

    revalidatePath("/users")
    return { success: true, count: result.count || 0 }
  } catch (error: any) {
    console.error("Error rejecting users:", error)
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      meta: error.meta,
    })
    return { success: false, error: error.message || "Failed to reject users" }
  }
}

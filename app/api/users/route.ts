import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    // Fetch users with all fields including status - read directly from database
    const users = await prisma.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        // Don't include password in response
      },
    })

    // Log the actual status values from database for debugging
    console.log("Users fetched from database:", users.map((u: any) => ({ 
      username: u.username, 
      status: u.status 
    })))

    // Return users exactly as they are in the database - no transformation
    // Only set default if status is null/undefined (shouldn't happen with default in schema)
    const usersWithStatus = users.map((user: any) => ({
      ...user,
      status: user.status ?? "PENDING", // Use nullish coalescing - only default if null/undefined
    }))

    return NextResponse.json(usersWithStatus)
  } catch (error: any) {
    console.error("Error fetching users:", error)
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      meta: error.meta,
    })
    
    // If status column doesn't exist, try fetching without it
    if (error.message?.includes("status") || error.message?.includes("does not exist") || error.code === "P2021") {
      try {
        const usersWithoutStatus = await prisma.user.findMany({
          orderBy: {
            createdAt: "desc",
          },
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        })
        // Add PENDING status to each user (not APPROVED)
        const users = usersWithoutStatus.map((user: any) => ({
          ...user,
          status: "PENDING",
        }))
        return NextResponse.json(users)
      } catch (fallbackError) {
        console.error("Fallback fetch also failed:", fallbackError)
      }
    }
    
    return NextResponse.json(
      { error: error.message || "Failed to fetch users" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, username, password, role, email } = body

    if (!name || !username || !password) {
      return NextResponse.json(
        { error: "Name, username, and password are required" },
        { status: 400 }
      )
    }

    const userData: any = {
      name,
      username,
      password, // In production, hash this password with bcrypt!
      role: role || "STUDENT",
      status: "PENDING", // New users should be PENDING by default
    }
    
    // Only include email if it's provided
    if (email) {
      userData.email = email
    }

    let user
    try {
      user = await prisma.user.create({
        data: userData,
      })
    } catch (dbError: any) {
      // If status column doesn't exist, create without it
      if (dbError.message?.includes("status") || dbError.message?.includes("does not exist") || dbError.code === "P2021") {
        const { status, ...userDataWithoutStatus } = userData
        user = await prisma.user.create({
          data: userDataWithoutStatus,
        })
        // Add status to response
        user = { ...user, status: "PENDING" }
      } else {
        throw dbError
      }
    }

    // Don't return password in response
    const { password: _, ...userWithoutPassword } = user
    return NextResponse.json(userWithoutPassword, { status: 201 })
  } catch (error: any) {
    console.error("Error creating user:", error)
    console.error("Error details:", {
      code: error.code,
      message: error.message,
      meta: error.meta,
    })
    
    // Handle unique constraint violations
    if (error.code === "P2002") {
      const field = error.meta?.target?.[0] || "username or email"
      return NextResponse.json(
        { error: `User with this ${field} already exists` },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to create user" },
      { status: 500 }
    )
  }
}

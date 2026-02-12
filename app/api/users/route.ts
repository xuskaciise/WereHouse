import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
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
        createdAt: true,
        updatedAt: true,
        // Don't include password in response
      },
    })
    return NextResponse.json(users)
  } catch (error) {
    console.error("Error fetching users:", error)
    return NextResponse.json(
      { error: "Failed to fetch users" },
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
    }
    
    // Only include email if it's provided
    if (email) {
      userData.email = email
    }

    const user = await prisma.user.create({
      data: userData,
    })

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

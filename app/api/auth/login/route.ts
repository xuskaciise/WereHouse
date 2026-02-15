import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      )
    }

    // Find user by username
    const user = await prisma.user.findUnique({
      where: { username },
    })

    if (!user) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      )
    }

    // Check password (in production, use bcrypt to compare hashed passwords)
    if (user.password !== password) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      )
    }

    // Check if user is approved - block PENDING, REJECTED, or null status
    const userStatus = user.status || "PENDING" // Default to PENDING if null
    
    if (userStatus === "PENDING") {
      return NextResponse.json(
        { error: "Your account is pending approval. Please wait for an administrator to approve your account before you can log in." },
        { status: 403 }
      )
    }

    if (userStatus === "REJECTED") {
      return NextResponse.json(
        { error: "Your account has been rejected. Please contact an administrator for assistance." },
        { status: 403 }
      )
    }

    // Only allow APPROVED users to log in
    if (userStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "Your account is not approved. Please contact an administrator." },
        { status: 403 }
      )
    }

    // Don't return password in response
    const { password: _, ...userWithoutPassword } = user
    return NextResponse.json(userWithoutPassword)
  } catch (error: any) {
    console.error("Error during login:", error)
    return NextResponse.json(
      { error: "Failed to authenticate user" },
      { status: 500 }
    )
  }
}

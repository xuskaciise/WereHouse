import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hashPassword, validatePassword } from "@/lib/password"

// Public student self-registration. The role and status are fixed server-side:
// every sign-up is a STUDENT account that stays PENDING until an admin approves it.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const username = typeof body?.username === "string" ? body.username.trim() : ""
    const password = body?.password

    if (!name || !username || name.length > 100 || username.length > 50) {
      return NextResponse.json({ error: "Name and ID number are required" }, { status: 400 })
    }
    const passwordError = validatePassword(password)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    await prisma.user.create({
      data: {
        name,
        username,
        passwordHash: await hashPassword(password),
        role: "STUDENT",
        status: "PENDING",
      },
    })

    return NextResponse.json(
      { message: "Account created. An administrator must approve it before you can sign in." },
      { status: 201 }
    )
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "This ID number is already registered" }, { status: 409 })
    }
    console.error("Error registering user:", error)
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 })
  }
}

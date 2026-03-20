import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const TABLES_TO_TRUNCATE = [
  // Child tables first to keep cross-database compatibility
  "purchase_order_items",
  "sales_order_items",
  "customer_payments",
  "supplier_payments",
  "stock_transfer_items",
  "stock_transfers",
  "stock_movements",
  "stock",
  // Core business tables requested for reset
  "purchase_orders",
  "sales_orders",
  "expenses",
  "products",
  "categories",
  "customers",
  "warehouses",
]

function isAdminFromHeader(value: string | null): boolean {
  return (value || "").trim().toLowerCase() === "admin"
}

async function getRequestAdminUser(request: Request) {
  const userId = request.headers.get("x-user-id")
  if (!userId) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, password: true },
  })

  return user
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const password = typeof body?.password === "string" ? body.password : ""

    if (!password) {
      return NextResponse.json(
        { success: false, error: "Admin password is required" },
        { status: 400 }
      )
    }

    const roleHeader = request.headers.get("x-user-role")
    const userTypeHeader = request.headers.get("x-user-type")
    const adminByHeader = isAdminFromHeader(roleHeader) || isAdminFromHeader(userTypeHeader)
    const adminUser = await getRequestAdminUser(request)
    const adminByDb = (adminUser?.role || "").toLowerCase() === "admin"

    if (!adminByHeader || !adminByDb || !adminUser) {
      return NextResponse.json(
        { success: false, error: "Forbidden: admin access required" },
        { status: 403 }
      )
    }

    // Current project stores plain passwords. If hashing is later introduced,
    // this check should be replaced with bcrypt/argon verification.
    if (!adminUser.password || adminUser.password !== password) {
      return NextResponse.json(
        { success: false, error: "Invalid admin password" },
        { status: 401 }
      )
    }

    // Use DB-specific strategy without poisoning a transaction state:
    // PostgreSQL marks the whole transaction as aborted after one SQL error.
    let resetCompleted = false

    // Strategy 1: MySQL-compatible flow (as requested)
    try {
      await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0")
      try {
        for (const table of TABLES_TO_TRUNCATE) {
          await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``)
        }
        resetCompleted = true
      } finally {
        await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1")
      }
    } catch {
      // Ignore and fallback to PostgreSQL-compatible truncate below.
    }

    // Strategy 2: PostgreSQL flow (project default)
    if (!resetCompleted) {
      const tableList = TABLES_TO_TRUNCATE.map((table) => `"${table}"`).join(", ")
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`)
      resetCompleted = true
    }

    if (!resetCompleted) {
      throw new Error("System reset was not completed")
    }

    return NextResponse.json({
      success: true,
      message: "System data reset completed successfully. Users were preserved.",
    })
  } catch (error: any) {
    console.error("System reset failed:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Failed to reset system data" },
      { status: 500 }
    )
  }
}


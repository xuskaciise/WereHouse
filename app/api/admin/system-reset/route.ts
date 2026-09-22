import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { verifyPassword } from "@/lib/password"

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

// ADMIN-only (checked against the server session by withAuth), plus the
// admin must re-enter their password.
export const POST = withAuth(async (request, { user: currentUser }) => {
  try {
    const body = await request.json().catch(() => ({}))
    const password = typeof body?.password === "string" ? body.password : ""

    if (!password) {
      return NextResponse.json(
        { success: false, error: "Admin password is required" },
        { status: 400 }
      )
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { passwordHash: true },
    })
    if (!(await verifyPassword(password, adminUser?.passwordHash))) {
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
}, { roles: ["ADMIN"] })

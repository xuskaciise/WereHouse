import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { verifyPassword } from "@/lib/password"

// Business data wiped by a reset. Users and settings are preserved.
// Hard-coded identifiers only; nothing user-supplied reaches the SQL.
const TABLES_TO_TRUNCATE = [
  "purchase_order_item_adjustments",
  "purchase_receive_items",
  "purchase_receives",
  "purchase_order_items",
  "sales_order_items",
  "customer_payments",
  "supplier_payments",
  "stock_transfer_items",
  "stock_transfers",
  "stock_movements",
  "stock",
  "purchase_orders",
  "sales_orders",
  "expenses",
  "expense_categories",
  "products",
  "categories",
  "customers",
  "suppliers",
  "warehouses",
]

// ADMIN-only (checked against the server session by withAuth), and the admin
// must re-enter their password.
export const POST = withAuth(
  async (request, { user }) => {
    const body = await readJson(request)
    const password = typeof body?.password === "string" ? body.password : ""
    if (!password) throw new HttpError(400, "Admin password is required")

    const admin = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    if (!(await verifyPassword(password, admin?.passwordHash))) {
      throw new HttpError(401, "Invalid admin password")
    }

    const tableList = Prisma.raw(TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", "))
    await prisma.$executeRaw`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`

    console.warn(`System data reset performed by user ${user.id}`)
    return json({
      success: true,
      message: "System data reset completed successfully. Users were preserved.",
    })
  },
  { roles: ["ADMIN"] }
)

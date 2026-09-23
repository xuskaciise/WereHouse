import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { withCustomerBalance } from "@/lib/balances"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = scopeWhere(user, "customers")
  return listResponse(request, {
    findMany: (page) => prisma.customer.findMany({ where, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.customer.count({ where }),
    map: withCustomerBalance,
  })
}, { permission: [["customers", "view"], ["customer_payments", "view"]] }) // also the payment form lookup

export const POST = withAuth(async (request, { user }) => {
  const { name, email, phone, address, city, state } = await readJson(request)
  if (!name) throw new HttpError(400, "Name is required")

  const customer = await prisma.customer.create({
    data: {
      name,
      email: email || "",
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      userId: user.id,
    },
  })

  return json({ ...customer, balance: 0 }, { status: 201 })
}, { permission: ["customers", "create"] })

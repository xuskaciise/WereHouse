import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { withSupplierBalance } from "@/lib/balances"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = scopeWhere(user, "suppliers")
  return listResponse(request, {
    findMany: (page) => prisma.supplier.findMany({ where, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.supplier.count({ where }),
    map: withSupplierBalance,
  })
}, { permission: [["suppliers", "view"], ["supplier_payments", "view"], ["purchases", "view"]] }) // also a lookup for payments/purchases

export const POST = withAuth(async (request, { user }) => {
  const body = await readJson(request)
  const { name, email, phone, address, city, state, zipCode, country, contactPerson } = body
  const type = body.type === undefined ? undefined : body.type
  if (type !== undefined && type !== "GOODS" && type !== "SERVICE_PROVIDER") {
    throw new HttpError(400, "Supplier type must be GOODS or SERVICE_PROVIDER")
  }

  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, "Name is required")
  if (typeof email !== "string" || !email.trim()) throw new HttpError(400, "Email is required")

  const supplier = await prisma.supplier.create({
    data: {
      name: name.trim(),
      email: email.trim(),
      phone: phone?.trim() || null,
      address: address?.trim() || null,
      city: city?.trim() || null,
      state: state?.trim() || null,
      zipCode: zipCode?.trim() || null,
      country: country?.trim() || null,
      contactPerson: contactPerson?.trim() || null,
      // SERVICE_PROVIDER: paid for landed costs (clearing, transport, commission).
      type: type ?? "GOODS",
      userId: user.id,
    },
  })

  return json({ ...supplier, balance: 0 }, { status: 201 })
}, { permission: ["suppliers", "create"] })

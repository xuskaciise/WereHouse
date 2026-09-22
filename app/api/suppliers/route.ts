import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { withSupplierBalance } from "@/lib/balances"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = ownershipWhere(user)
  return listResponse(request, {
    findMany: (page) => prisma.supplier.findMany({ where, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.supplier.count({ where }),
    map: withSupplierBalance,
  })
})

export const POST = withAuth(async (request, { user }) => {
  const { name, email, phone, address, city, state, zipCode, country, contactPerson } = await readJson(request)

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
      userId: user.id,
    },
  })

  return json({ ...supplier, balance: 0 }, { status: 201 })
})

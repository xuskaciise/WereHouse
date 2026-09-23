import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertInScope } from "@/lib/permissions"
import { withCustomerBalance } from "@/lib/balances"

const NOT_FOUND = "Customer not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const customer = await prisma.customer.findUnique({ where: { id: params.id } })
  assertInScope(user, "customers", customer, NOT_FOUND)
  const [withBalance] = await withCustomerBalance([customer])
  return json(withBalance)
}, { permission: ["customers", "view"] })

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const existing = await prisma.customer.findUnique({ where: { id: params.id } })
  assertInScope(user, "customers", existing, NOT_FOUND)

  const { name, email, phone, address, city, state } = await readJson(request)
  if (!name) throw new HttpError(400, "Name is required")

  const customer = await prisma.customer.update({
    where: { id: params.id },
    data: {
      name,
      email: email || "",
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
    },
  })
  const [withBalance] = await withCustomerBalance([customer])
  return json(withBalance)
}, { permission: ["customers", "edit"] })

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const existing = await prisma.customer.findUnique({ where: { id: params.id } })
  assertInScope(user, "customers", existing, NOT_FOUND)

  await withConflictMessages(() => prisma.customer.delete({ where: { id: params.id } }), {
    inUse: "Cannot delete customer that has sales orders. Please remove all related sales orders first.",
  })
  return json({ message: "Customer deleted successfully" })
}, { permission: ["customers", "delete"] })

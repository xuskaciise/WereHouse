import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError, type SessionUser } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"

type Db = Prisma.TransactionClient | typeof prisma

interface ReferencedIds {
  supplierId?: string | null
  customerId?: string | null
  warehouseId?: string | null
  categoryId?: string | null
  productIds?: (string | null | undefined)[]
}

/**
 * Verifies that every referenced record exists and is within the user's scope
 * for its module (company-wide for scope ALL, own records for scope OWN).
 * Prevents referencing records outside the user's scope by guessing ids.
 */
export async function assertCanReference(user: SessionUser, ids: ReferencedIds, db: Db = prisma): Promise<void> {

  const checks: Promise<boolean>[] = []
  const one = async (count: Promise<number>) => (await count) === 1

  if (ids.supplierId) checks.push(one(db.supplier.count({ where: { id: ids.supplierId, ...scopeWhere(user, "suppliers") } })))
  if (ids.customerId) checks.push(one(db.customer.count({ where: { id: ids.customerId, ...scopeWhere(user, "customers") } })))
  if (ids.warehouseId) checks.push(one(db.warehouse.count({ where: { id: ids.warehouseId, ...scopeWhere(user, "warehouses") } })))
  if (ids.categoryId) checks.push(one(db.category.count({ where: { id: ids.categoryId, ...scopeWhere(user, "categories") } })))

  const productIds = Array.from(new Set((ids.productIds ?? []).filter((id): id is string => !!id)))
  if (productIds.length > 0) {
    checks.push(
      db.product
        .count({ where: { id: { in: productIds }, ...scopeWhere(user, "products") } })
        .then((count) => count === productIds.length)
    )
  }

  const results = await Promise.all(checks)
  if (results.some((ok) => !ok)) {
    throw new HttpError(400, "One or more referenced records do not exist or are not accessible")
  }
}

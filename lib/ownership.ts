import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError, isAdmin, type SessionUser } from "@/lib/auth-guard"

type Db = Prisma.TransactionClient | typeof prisma

interface ReferencedIds {
  supplierId?: string | null
  customerId?: string | null
  warehouseId?: string | null
  categoryId?: string | null
  expenseCategoryId?: string | null
  productIds?: (string | null | undefined)[]
}

/**
 * Verifies that every referenced record exists and, for non-admins, belongs
 * to the current user. Prevents creating orders/payments against another
 * user's suppliers, customers, warehouses or products by guessing ids.
 */
export async function assertCanReference(user: SessionUser, ids: ReferencedIds, db: Db = prisma): Promise<void> {
  const owner = isAdmin(user) ? {} : { userId: user.id }

  const checks: Promise<boolean>[] = []
  const one = async (count: Promise<number>) => (await count) === 1

  if (ids.supplierId) checks.push(one(db.supplier.count({ where: { id: ids.supplierId, ...owner } })))
  if (ids.customerId) checks.push(one(db.customer.count({ where: { id: ids.customerId, ...owner } })))
  if (ids.warehouseId) checks.push(one(db.warehouse.count({ where: { id: ids.warehouseId, ...owner } })))
  if (ids.categoryId) checks.push(one(db.category.count({ where: { id: ids.categoryId, ...owner } })))
  if (ids.expenseCategoryId) {
    checks.push(one(db.expenseCategory.count({ where: { id: ids.expenseCategoryId, ...owner } })))
  }

  const productIds = Array.from(new Set((ids.productIds ?? []).filter((id): id is string => !!id)))
  if (productIds.length > 0) {
    checks.push(
      db.product
        .count({ where: { id: { in: productIds }, ...owner } })
        .then((count) => count === productIds.length)
    )
  }

  const results = await Promise.all(checks)
  if (results.some((ok) => !ok)) {
    throw new HttpError(400, "One or more referenced records do not exist or are not accessible")
  }
}

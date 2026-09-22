import type { Prisma } from "@prisma/client"

export const userSummarySelect = {
  id: true,
  name: true,
  username: true,
} satisfies Prisma.UserSelect

export const supplierPaymentInclude = {
  supplier: true,
  purchaseOrder: true,
  user: { select: userSummarySelect },
} satisfies Prisma.SupplierPaymentInclude

export const customerPaymentInclude = {
  customer: true,
  salesOrder: true,
  user: { select: userSummarySelect },
} satisfies Prisma.CustomerPaymentInclude

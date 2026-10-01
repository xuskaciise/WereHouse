import type { Prisma } from "@prisma/client"
import { paymentAllocationsInclude } from "@/lib/cost-payments"

export const userSummarySelect = {
  id: true,
  name: true,
  username: true,
} satisfies Prisma.UserSelect

export const supplierPaymentInclude = {
  supplier: true,
  purchaseOrder: true,
  user: { select: userSummarySelect },
  // Cost lines the payment settled (receipt).
  allocations: paymentAllocationsInclude,
} satisfies Prisma.SupplierPaymentInclude

export const customerPaymentInclude = {
  customer: true,
  salesOrder: true,
  user: { select: userSummarySelect },
} satisfies Prisma.CustomerPaymentInclude

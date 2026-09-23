import type { Role } from "@prisma/client"

// Shared by the API and the UI (no server-only imports). The server is the
// authority; the UI only uses these to preview totals and hide options.

/** Purchase order tax rate as a fraction (8%). */
export const PURCHASE_TAX_RATE = "0.08"

/** Roles allowed to over-receive a line or close its remainder. */
export const PURCHASE_ADJUST_ROLES: readonly Role[] = ["ADMIN", "WAREHOUSE_MANAGER"]

export function canAdjustPurchaseQuantities(role: Role): boolean {
  return PURCHASE_ADJUST_ROLES.includes(role)
}

/** Fully received purchase orders are stored as CONFIRMED and shown as "RECEIVED". */
export function purchaseStatusLabel(status: string): string {
  return status === "CONFIRMED" ? "RECEIVED" : status
}

export const ADJUSTMENT_REASON_MAX_LENGTH = 500

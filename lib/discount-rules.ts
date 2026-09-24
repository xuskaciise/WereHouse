// Shared by the API and the UI (no server-only imports). The server
// recalculates and enforces everything; the UI uses these for the preview.
// Who may give discounts, and up to which %, is the sales_discount
// permission (lib/permission-rules.ts, Roles & Permissions page).

/** A reason is required above the limit, and always above this percentage. */
export const DISCOUNT_REASON_THRESHOLD_PERCENT = 20

export const DISCOUNT_REASON_MAX_LENGTH = 500

export type DiscountTypeValue = "PERCENT" | "AMOUNT"

/** Whether a reason is required for this total discount percentage. */
export function discountReasonRequired(discountPercent: number, limitPercent: number): boolean {
  return discountPercent > Math.min(limitPercent, DISCOUNT_REASON_THRESHOLD_PERCENT)
}

/** Total discount given on a sales order (item discounts + order discount). */
export function totalDiscountOf(order: { discount?: unknown; itemDiscount?: unknown }): number {
  return Math.round((Number(order.discount || 0) + Number(order.itemDiscount || 0)) * 100) / 100
}

/** "10%" for a percentage discount, "" for a fixed amount or none. */
export function discountLabel(type: unknown, value: unknown): string {
  return type === "PERCENT" ? `${Number(value)}%` : ""
}

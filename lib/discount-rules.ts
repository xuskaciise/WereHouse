import type { Role } from "@prisma/client"

// Shared by the API and the UI (no server-only imports). The server
// recalculates and enforces everything; the UI uses these for the preview.

/** Sales tax rate as a fraction (5%), applied after all discounts. */
export const SALES_TAX_RATE = "0.05"

/** Roles that may give any discount (no percentage limit). */
export const UNLIMITED_DISCOUNT_ROLES: Role[] = ["ADMIN", "WAREHOUSE_MANAGER"]

/** Settings key (and default) for the maximum total discount % of other roles. */
export const MAX_SALES_DISCOUNT_SETTING = "maxSalesDiscountPercent"
export const DEFAULT_MAX_SALES_DISCOUNT_PERCENT = 10

/** A reason is required above the limit, and always above this percentage. */
export const DISCOUNT_REASON_THRESHOLD_PERCENT = 20

export const DISCOUNT_REASON_MAX_LENGTH = 500

export type DiscountTypeValue = "PERCENT" | "AMOUNT"

export function hasUnlimitedDiscount(role: Role): boolean {
  return UNLIMITED_DISCOUNT_ROLES.includes(role)
}

/** Reads the setting value; falls back to the default when missing or invalid. */
export function parseMaxDiscountPercent(value: unknown): number {
  const n = Number(value)
  return value !== "" && value !== null && Number.isFinite(n) && n >= 0 && n <= 100
    ? n
    : DEFAULT_MAX_SALES_DISCOUNT_PERCENT
}

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

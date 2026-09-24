import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Currencies the company can choose in Settings (Default Currency). */
export const CURRENCIES = ["USD", "SOS"] as const
export type Currency = (typeof CURRENCIES)[number]

// Company currency for formatCurrency(); set from Settings by the dashboard
// layout (CurrentUserProvider). One value for the whole company.
let currentCurrency: Currency = "USD"
export function setCurrency(code: unknown) {
  currentCurrency = CURRENCIES.includes(code as Currency) ? (code as Currency) : "USD"
}

export function formatCurrency(amount: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currentCurrency,
  }).format(Number(amount ?? 0))
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d)
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

/** Unit cost with 4 decimals in the company currency, e.g. "$31.1551". */
export function formatUnitCost(amount: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currentCurrency,
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(Number(amount ?? 0))
}

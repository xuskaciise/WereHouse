// Tax rates come from Settings (percent, 0-100, max 2 decimals):
//   purchases -> purchaseTaxRate, sales -> salesTaxRate; an empty specific
//   rate falls back to defaultTaxRate, and an empty default to 0.
// Each order stores the rate used at creation (taxRate), and every later
// recalculation of that order uses its stored rate, so changing Settings
// never changes existing orders. Client-safe (forms preview the same rate).

export const TAX_SETTINGS = {
  default: "defaultTaxRate",
  sales: "salesTaxRate",
  purchase: "purchaseTaxRate",
} as const

export type TaxKind = "sales" | "purchase"

/** Valid rate as a number, or null when empty / invalid. */
export function parseTaxRate(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (text === "" || !/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null
  const n = Number(text)
  return n >= 0 && n <= 100 ? n : null
}

export function isValidTaxRateInput(value: unknown): boolean {
  return String(value ?? "").trim() === "" || parseTaxRate(value) !== null
}

export function resolveTaxRate(settings: Record<string, unknown> | null | undefined, kind: TaxKind): number {
  return parseTaxRate(settings?.[TAX_SETTINGS[kind]]) ?? parseTaxRate(settings?.[TAX_SETTINGS.default]) ?? 0
}

/** "Tax (8%)", "Tax (7.5%)". */
export function taxLabel(rate: unknown): string {
  return `Tax (${Number(rate ?? 0)}%)`
}

// Payment methods: one shared list for every form that records a payment
// (customer / supplier payments incl. landed and transfer costs, expenses).
// Client-safe: used by the API for validation and by the UI for forms and
// display. Which methods are enabled and the expected mobile prefixes live
// in Settings (PAYMENT_METHOD_SETTING), editable by ADMIN.

export interface PaymentMethod {
  code: string
  label: string
  /** Mobile money: needs the payer's phone number (+252) and takes a transaction ID. */
  mobile?: boolean
  operator?: string
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  { code: "CASH", label: "Cash" },
  { code: "EVC_PLUS", label: "EVC Plus", mobile: true, operator: "Hormuud" },
  { code: "ZAAD", label: "ZAAD", mobile: true, operator: "Telesom" },
  { code: "EDAHAB", label: "E-Dahab", mobile: true, operator: "Somtel" },
  { code: "BANK_TRANSFER", label: "Bank transfer" },
  { code: "CREDIT_CARD", label: "Card" },
  { code: "CHECK", label: "Cheque" },
  { code: "OTHER", label: "Other" },
]

export const PAYMENT_METHOD_SETTING = "paymentMethodConfig"

export interface PaymentMethodConfig {
  /** Codes hidden in forms (old records keep them). */
  disabled: string[]
  /** Expected operator prefixes (2 digits after +252) per mobile method. */
  prefixes: Record<string, string[]>
}

// NCA numbering plan (Sept 2024) + 77 for Hormuud. Sources disagree on some
// prefixes, so a mismatch is only ever a warning.
export const DEFAULT_PAYMENT_CONFIG: PaymentMethodConfig = {
  disabled: [],
  prefixes: { EVC_PLUS: ["61", "68", "77"], ZAAD: ["63", "67"], EDAHAB: ["62", "65", "66"] },
}

export const TRANSACTION_ID_MAX_LENGTH = 50

export function findMethod(code: string | null | undefined): PaymentMethod | undefined {
  return PAYMENT_METHODS.find((m) => m.code === code)
}

/** Label for display; legacy / unknown codes are shown as stored. */
export function methodLabel(code: string | null | undefined): string {
  return findMethod(code)?.label ?? (code || "-")
}

export function isMobileMethod(code: string | null | undefined): boolean {
  return !!findMethod(code)?.mobile
}

/** Parses the stored setting; anything missing or invalid falls back to the defaults. */
export function parsePaymentConfig(raw: unknown): PaymentMethodConfig {
  let value: any = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
  }
  const disabled = Array.isArray(value?.disabled)
    ? value.disabled.filter((c: unknown) => typeof c === "string" && findMethod(c as string))
    : DEFAULT_PAYMENT_CONFIG.disabled
  const prefixes: Record<string, string[]> = {}
  for (const m of PAYMENT_METHODS.filter((m) => m.mobile)) {
    const list = value?.prefixes?.[m.code]
    prefixes[m.code] = Array.isArray(list)
      ? list.filter((p: unknown) => typeof p === "string" && /^\d{2}$/.test(p))
      : DEFAULT_PAYMENT_CONFIG.prefixes[m.code] ?? []
  }
  return { disabled, prefixes }
}

/**
 * Normalizes a Somali mobile number to +252XXXXXXXXX (9 digits after the
 * country code). Accepts 612345678, 0612345678, 252612345678, 00252...,
 * "+252 61 234 5678"; spaces, dashes, dots and brackets are ignored.
 * Returns null when it is not 9 digits after +252.
 */
export function normalizeSomaliPhone(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null
  let digits = String(input).trim().replace(/[\s\-().]/g, "")
  if (digits.startsWith("+")) digits = digits.slice(1)
  if (!/^\d+$/.test(digits)) return null
  if (digits.startsWith("00252")) digits = digits.slice(5)
  else if (digits.startsWith("252") && digits.length === 12) digits = digits.slice(3)
  else if (digits.startsWith("0") && digits.length === 10) digits = digits.slice(1)
  return /^\d{9}$/.test(digits) ? `+252${digits}` : null
}

/** "+252612345678" -> "+252 61 234 5678" (anything else is returned unchanged). */
export function formatSomaliPhone(phone: string | null | undefined): string {
  if (!phone) return ""
  const m = /^\+252(\d{2})(\d{3})(\d{4})$/.exec(phone)
  return m ? `+252 ${m[1]} ${m[2]} ${m[3]}` : phone
}

/** Warning text when the number's prefix is not one expected for the method, else null. */
export function prefixWarning(code: string, phone: string | null, config: PaymentMethodConfig): string | null {
  const method = findMethod(code)
  if (!method?.mobile || !phone) return null
  const expected = config.prefixes[code] ?? []
  if (expected.length === 0) return null
  const prefix = phone.slice(4, 6)
  if (expected.includes(prefix)) return null
  return `${formatSomaliPhone(phone)} does not look like a ${method.label} number (expected ${expected.map((p) => `${p}…`).join(", ")}). Check the number; it can still be saved.`
}

/** One-line description for lists and receipts, e.g. "EVC Plus · +252 61 234 5678 · Tx 123". */
export function paymentSummary(p: { paymentMethod?: string | null; payerPhone?: string | null; transactionId?: string | null }): string {
  return [methodLabel(p.paymentMethod), formatSomaliPhone(p.payerPhone), p.transactionId ? `Tx ${p.transactionId}` : ""]
    .filter(Boolean)
    .join(" · ")
}

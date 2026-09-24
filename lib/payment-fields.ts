import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import {
  PAYMENT_METHOD_SETTING,
  TRANSACTION_ID_MAX_LENGTH,
  type PaymentMethodConfig,
  findMethod,
  normalizeSomaliPhone,
  parsePaymentConfig,
  prefixWarning,
} from "@/lib/payment-methods"

// Server-side validation of the payment method fields, shared by every route
// that records a payment (customer / supplier payments, "paid now" landed and
// transfer costs, expenses).

export async function getPaymentConfig(): Promise<PaymentMethodConfig> {
  const setting = await prisma.setting.findUnique({ where: { key: PAYMENT_METHOD_SETTING } })
  return parsePaymentConfig(setting?.value)
}

export interface PaymentFields {
  paymentMethod: string
  payerPhone: string | null
  transactionId: string | null
  /** Non-blocking notices, e.g. the phone prefix does not match the operator. */
  warnings: string[]
}

/**
 * Validates { paymentMethod, payerPhone, transactionId }.
 * - the method must be known and enabled; an existing record may keep its
 *   current method even if it was disabled (or is a legacy value) later
 * - mobile money needs a phone (9 digits after +252, normalized); the
 *   transaction ID is optional
 * - a phone prefix that does not match the operator only produces a warning
 */
export async function parsePaymentFields(body: any, options: { existingMethod?: string | null } = {}): Promise<PaymentFields> {
  const code = typeof body?.paymentMethod === "string" ? body.paymentMethod.trim() : ""
  if (!code) throw new HttpError(400, "Payment method is required")
  const keepingExisting = !!options.existingMethod && code === options.existingMethod
  const method = findMethod(code)
  const config = await getPaymentConfig()
  if (!keepingExisting) {
    if (!method) throw new HttpError(400, "Unknown payment method")
    if (config.disabled.includes(code)) throw new HttpError(400, `${method.label} is disabled in Settings`)
  }

  if (!method?.mobile) return { paymentMethod: code, payerPhone: null, transactionId: null, warnings: [] }

  const payerPhone = normalizeSomaliPhone(body.payerPhone)
  if (!payerPhone) {
    throw new HttpError(400, `${method.label} needs the payer's phone number: 9 digits after +252 (e.g. 61 234 5678)`)
  }
  let transactionId: string | null = null
  if (body.transactionId !== undefined && body.transactionId !== null && body.transactionId !== "") {
    if (typeof body.transactionId !== "string") throw new HttpError(400, "Transaction ID must be text")
    transactionId = body.transactionId.trim().slice(0, TRANSACTION_ID_MAX_LENGTH + 1) || null
    if (transactionId && transactionId.length > TRANSACTION_ID_MAX_LENGTH) {
      throw new HttpError(400, `Transaction ID must be at most ${TRANSACTION_ID_MAX_LENGTH} characters`)
    }
  }
  const warning = prefixWarning(code, payerPhone, config)
  return { paymentMethod: code, payerPhone, transactionId, warnings: warning ? [warning] : [] }
}

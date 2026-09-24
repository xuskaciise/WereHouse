"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DEFAULT_PAYMENT_CONFIG,
  PAYMENT_METHODS,
  PAYMENT_METHOD_SETTING,
  TRANSACTION_ID_MAX_LENGTH,
  type PaymentMethodConfig,
  findMethod,
  methodLabel,
  normalizeSomaliPhone,
  parsePaymentConfig,
  prefixWarning,
} from "@/lib/payment-methods"

// The one payment method picker used by every payment form. Mobile money
// (EVC Plus, ZAAD, E-Dahab) adds the payer's phone (fixed +252 prefix) and an
// optional transaction ID. The server validates the same rules
// (lib/payment-fields.ts); a prefix mismatch is only a warning.

export interface PaymentMethodValue {
  paymentMethod: string
  /** As typed (local 9 digits, or pasted with 252 / +252 / 0); normalized by the server. */
  payerPhone: string
  transactionId: string
}

export const emptyPaymentMethod = (paymentMethod = ""): PaymentMethodValue => ({ paymentMethod, payerPhone: "", transactionId: "" })

/** Form value for an existing record (phone shown without +252). */
export function paymentMethodValueOf(record: { paymentMethod?: string | null; payerPhone?: string | null; transactionId?: string | null } | null | undefined): PaymentMethodValue {
  return {
    paymentMethod: record?.paymentMethod ?? "",
    payerPhone: record?.payerPhone?.startsWith("+252") ? record.payerPhone.slice(4) : record?.payerPhone ?? "",
    transactionId: record?.transactionId ?? "",
  }
}

/** Request body fields for the API. */
export function paymentMethodBody(value: PaymentMethodValue) {
  const mobile = findMethod(value.paymentMethod)?.mobile
  return {
    paymentMethod: value.paymentMethod,
    payerPhone: mobile ? value.payerPhone : null,
    transactionId: mobile ? value.transactionId || null : null,
  }
}

let configRequest: Promise<PaymentMethodConfig> | null = null
/** Payment method settings (enabled methods, prefixes), loaded once per page. */
export function usePaymentConfig(): PaymentMethodConfig {
  const [config, setConfig] = useState<PaymentMethodConfig>(DEFAULT_PAYMENT_CONFIG)
  useEffect(() => {
    configRequest ??= fetch("/api/settings")
      .then((r): Promise<Record<string, unknown>> => (r.ok ? r.json() : Promise.resolve({})))
      .then((s) => parsePaymentConfig(s?.[PAYMENT_METHOD_SETTING]))
      .catch(() => DEFAULT_PAYMENT_CONFIG)
    configRequest.then(setConfig)
  }, [])
  return config
}

/** Client-side check matching the server: error (blocks) or warning (does not). */
export function paymentMethodProblems(value: PaymentMethodValue, config: PaymentMethodConfig) {
  const method = findMethod(value.paymentMethod)
  if (!value.paymentMethod) return { error: "Choose a payment method", warning: null }
  if (!method?.mobile) return { error: null, warning: null }
  const phone = normalizeSomaliPhone(value.payerPhone)
  if (!phone) return { error: `${method.label}: enter the 9-digit phone number after +252`, warning: null }
  return { error: null, warning: prefixWarning(value.paymentMethod, phone, config) }
}

export function PaymentMethodFields({
  value,
  onChange,
  existingMethod,
  idPrefix = "payment",
  required = true,
}: {
  value: PaymentMethodValue
  onChange: (value: PaymentMethodValue) => void
  /** Method of the record being edited: kept selectable even if disabled since. */
  existingMethod?: string | null
  idPrefix?: string
  required?: boolean
}) {
  const config = usePaymentConfig()
  const options = PAYMENT_METHODS.filter((m) => !config.disabled.includes(m.code) || m.code === existingMethod)
  const legacy = existingMethod && !findMethod(existingMethod) ? existingMethod : null
  const method = findMethod(value.paymentMethod)
  const phone = normalizeSomaliPhone(value.payerPhone)
  const { warning } = paymentMethodProblems(value, config)

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-method`}>Payment Method{required ? " *" : ""}</Label>
        <Select value={value.paymentMethod} onValueChange={(paymentMethod) => onChange({ ...value, paymentMethod })}>
          <SelectTrigger id={`${idPrefix}-method`}>
            <SelectValue placeholder="Select payment method" />
          </SelectTrigger>
          <SelectContent>
            {options.map((m) => (
              <SelectItem key={m.code} value={m.code}>
                {m.label}
                {m.operator ? ` (${m.operator})` : ""}
                {config.disabled.includes(m.code) ? " – disabled" : ""}
              </SelectItem>
            ))}
            {legacy && <SelectItem value={legacy}>{methodLabel(legacy)}</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {method?.mobile && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-phone`}>Phone number *</Label>
            <div className="flex">
              <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                +252
              </span>
              <Input
                id={`${idPrefix}-phone`}
                inputMode="numeric"
                autoComplete="tel"
                className="rounded-l-none"
                placeholder="61 234 5678"
                value={value.payerPhone}
                onChange={(e) => onChange({ ...value, payerPhone: e.target.value.replace(/[^\d\s+]/g, "") })}
                onBlur={() => {
                  // Pasted 252… / +252… / 0… numbers become the 9 local digits.
                  if (phone) onChange({ ...value, payerPhone: phone.slice(4) })
                }}
              />
            </div>
            {value.payerPhone && !phone && <p className="text-xs text-destructive">9 digits after +252, e.g. 61 234 5678</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-tx`}>Transaction ID</Label>
            <Input
              id={`${idPrefix}-tx`}
              placeholder="From the confirmation SMS (optional)"
              maxLength={TRANSACTION_ID_MAX_LENGTH}
              value={value.transactionId}
              onChange={(e) => onChange({ ...value, transactionId: e.target.value })}
            />
          </div>
          {warning && (
            <p className="flex items-start gap-1 text-xs text-yellow-700 dark:text-yellow-500 sm:col-span-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

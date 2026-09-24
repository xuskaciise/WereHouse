"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { PAYMENT_METHODS, parsePaymentConfig, type PaymentMethodConfig } from "@/lib/payment-methods"

// Settings: which payment methods appear in forms, and the expected operator
// prefixes for mobile money (a mismatch only shows a warning). Saved with the
// other settings as JSON (key paymentMethodConfig).
export function PaymentMethodsCard({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (json: string) => void
  disabled: boolean
}) {
  const config = parsePaymentConfig(value)
  // Prefix fields are edited as text ("61, 68, 77") and parsed on change.
  const [prefixText, setPrefixText] = useState<Record<string, string>>({})
  useEffect(() => {
    setPrefixText(Object.fromEntries(Object.entries(config.prefixes).map(([code, list]) => [code, list.join(", ")])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === ""])

  const update = (next: PaymentMethodConfig) => onChange(JSON.stringify(next))
  const enabledCount = PAYMENT_METHODS.length - config.disabled.length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment methods</CardTitle>
        <CardDescription>
          Disabled methods are hidden in forms; old records keep them. Mobile money numbers are checked against the
          operator prefixes (2 digits after +252): a mismatch only shows a warning and never blocks saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {PAYMENT_METHODS.map((m) => {
          const enabled = !config.disabled.includes(m.code)
          return (
            <div key={m.code} className="grid items-center gap-3 sm:grid-cols-[220px_1fr]">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={enabled}
                  disabled={disabled || (enabled && enabledCount === 1)}
                  onCheckedChange={(checked) =>
                    update({
                      ...config,
                      disabled: checked ? config.disabled.filter((c) => c !== m.code) : [...config.disabled, m.code],
                    })
                  }
                />
                {m.label}
                {m.operator && <span className="text-muted-foreground">({m.operator})</span>}
              </label>
              {m.mobile ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Prefixes</span>
                  <Input
                    className="h-8 max-w-xs"
                    disabled={disabled}
                    placeholder="e.g. 61, 77"
                    value={prefixText[m.code] ?? ""}
                    onChange={(e) => {
                      setPrefixText({ ...prefixText, [m.code]: e.target.value })
                      const list = e.target.value.split(/[\s,;]+/).filter((p) => /^\d{2}$/.test(p))
                      update({ ...config, prefixes: { ...config.prefixes, [m.code]: list } })
                    }}
                  />
                </div>
              ) : (
                <span />
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

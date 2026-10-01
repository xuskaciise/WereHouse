"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency } from "@/lib/utils"
import {
  PaymentMethodFields,
  emptyPaymentMethod,
  paymentMethodBody,
  paymentMethodProblems,
  usePaymentConfig,
  type PaymentMethodValue,
} from "@/components/payment-method-fields"

// Record a customer payment for a sales order, or a supplier payment for a
// purchase order, from the order page (same API as the Payments page).

export function RecordPaymentDialog({
  open,
  onOpenChange,
  kind,
  partyId,
  partyName,
  orderId,
  orderNumber,
  suggested,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "customer" | "supplier"
  partyId: string
  partyName: string
  orderId: string
  orderNumber: string
  suggested: number
  onSaved: () => void
}) {
  const { toast } = useToast()
  const config = usePaymentConfig()
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState("")
  const [reference, setReference] = useState("")
  const [method, setMethod] = useState<PaymentMethodValue>(emptyPaymentMethod("CASH"))
  const [busy, setBusy] = useState(false)

  // Fresh form each time it opens, prefilled with what is still open.
  useEffect(() => {
    if (!open) return
    setAmount(suggested > 0 ? suggested.toFixed(2) : "")
    setDate(new Date().toISOString().slice(0, 10))
    setReference("")
    setMethod(emptyPaymentMethod("CASH"))
  }, [open, suggested])

  const problem = paymentMethodProblems(method, config)
  const save = async () => {
    setBusy(true)
    try {
      const url = kind === "customer" ? "/api/customer-payments" : "/api/supplier-payments"
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(kind === "customer" ? { customerId: partyId, salesOrderId: orderId } : { supplierId: partyId, purchaseOrderId: orderId }),
          amount,
          paymentDate: date,
          reference: reference || orderNumber,
          ...paymentMethodBody(method),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to record the payment")
      toast({ title: "Payment recorded", description: `${formatCurrency(amount)} ${kind === "customer" ? "from" : "to"} ${partyName}` })
      for (const w of data.warnings ?? []) toast({ title: "Please check", description: w })
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind === "customer" ? "Receive payment" : "Pay supplier"} · {orderNumber}</DialogTitle>
          <DialogDescription>
            {kind === "customer" ? "From" : "To"} {partyName}. {suggested > 0 ? `Still open on this order: ${formatCurrency(suggested)}.` : "Nothing is open on this order (an advance is allowed)."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Amount *</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <PaymentMethodFields value={method} onChange={setMethod} idPrefix={`${kind}-order-pay`} />
          {problem.warning && <p className="text-xs text-yellow-700">{problem.warning}</p>}
          <div className="space-y-1"><Label>Reference</Label><Input value={reference} placeholder={orderNumber} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !(Number(amount) > 0) || !!problem.error} onClick={save}>{busy ? "Saving..." : "Record payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

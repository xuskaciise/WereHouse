"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"
import { formatCurrency } from "@/lib/utils"
import {
  PaymentMethodFields,
  emptyPaymentMethod,
  paymentMethodBody,
  paymentMethodProblems,
  usePaymentConfig,
  type PaymentMethodValue,
} from "@/components/payment-method-fields"

const cents = (v: unknown) => Math.round(Number(v || 0) * 100)
type Row = { good: string; damaged: string }

export default function NewSalesReturnPage() {
  const router = useRouter()
  const { toast } = useToast()
  const canRefund = useCan("customer_payments", "create")
  const paymentConfig = usePaymentConfig()
  const [orders, setOrders] = useState<any[]>([])
  const [orderId, setOrderId] = useState("")
  const [order, setOrder] = useState<any | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [refundNow, setRefundNow] = useState(false)
  const [refundAmount, setRefundAmount] = useState("")
  const [refundRef, setRefundRef] = useState("")
  const [method, setMethod] = useState<PaymentMethodValue>(emptyPaymentMethod("CASH"))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("order")
    if (fromUrl) setOrderId(fromUrl)
    Promise.all([
      fetch("/api/sales-orders?status=DELIVERED&view=summary").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/sales-orders?status=PARTIALLY_DELIVERED&view=summary").then((r) => (r.ok ? r.json() : [])),
    ]).then(([a, b]) => setOrders([...a, ...b]))
  }, [])

  useEffect(() => {
    if (!orderId) return setOrder(null)
    fetch(`/api/sales-orders/${orderId}/returnable`).then(async (r) => {
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast({ title: "Error", description: data.error || "Failed to load the order", variant: "destructive" })
        return setOrder(null)
      }
      setOrder(data)
      setRows({})
    })
  }, [orderId, toast])

  const lines = order?.lines ?? []
  const qtyOf = (id: string) => (Number(rows[id]?.good) || 0) + (Number(rows[id]?.damaged) || 0)
  const errors: string[] = lines.flatMap((l: any) => {
    const r = rows[l.itemId]
    if (!r) return []
    const vals = [r.good, r.damaged].filter((v) => v !== "" && v !== undefined).map(Number)
    if (vals.some((v) => !Number.isInteger(v) || v < 0)) return [`${l.product.name}: whole numbers only`]
    if (qtyOf(l.itemId) > l.returnable) return [`${l.product.name}: only ${l.returnable} delivered unit(s) can be returned`]
    return []
  })
  // Preview only (the server computes the exact credit note).
  const amountCents = lines.reduce((s: number, l: any) => s + Math.round((cents(l.subtotal) * qtyOf(l.itemId)) / l.quantity), 0)
  const subtotalCents = cents(order?.subtotal)
  const shareCents = (v: unknown) => (subtotalCents ? Math.round((cents(v) * amountCents) / subtotalCents) : 0)
  const creditCents = amountCents - shareCents(order?.discount) + shareCents(order?.tax)
  const units = lines.reduce((s: number, l: any) => s + qtyOf(l.itemId), 0)
  const refundError =
    refundNow && (cents(refundAmount) <= 0 || cents(refundAmount) > creditCents + 1)
      ? "The refund must be more than 0 and at most the credit note"
      : refundNow
      ? paymentMethodProblems(method, paymentConfig).error
      : null

  const submit = async () => {
    setSaving(true)
    try {
      const body = {
        salesOrderId: orderId,
        lines: Object.entries(rows).flatMap(([itemId, r]) => [
          { itemId, quantity: Number(r.good || 0), condition: "RESELLABLE" },
          { itemId, quantity: Number(r.damaged || 0), condition: "DAMAGED" },
        ]),
        reason,
        notes,
        refund: refundNow ? { amount: refundAmount, reference: refundRef, ...paymentMethodBody(method) } : undefined,
      }
      const res = await fetch("/api/sales-returns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      toast({ title: `Credit note ${data.returnNumber} saved`, description: "Revenue and cost were reversed and the customer balance reduced." })
      router.push(`/sales/returns/${data.id}`)
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const set = (id: string, patch: Partial<Row>) => setRows({ ...rows, [id]: { ...(rows[id] ?? { good: "", damaged: "" }), ...patch } })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon"><Link href="/sales/returns"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customer return</h1>
          <p className="text-muted-foreground">Only delivered units that were not returned yet</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Sales order</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Combobox
            options={orders.map((o) => ({ value: o.id, label: `${o.orderNumber} - ${o.customer?.name ?? ""}` }))}
            value={orderId}
            onValueChange={setOrderId}
            placeholder={order ? `${order.orderNumber} - ${order.customer?.name}` : "Select a delivered sales order"}
            searchPlaceholder="Search orders..."
            emptyMessage="No delivered sales orders."
          />
          {order && <p className="text-sm text-muted-foreground">Customer {order.customer?.name} · warehouse {order.warehouse?.name}</p>}
        </CardContent>
      </Card>

      {order && (
        <Card>
          <CardHeader>
            <CardTitle>Returned goods</CardTitle>
            <CardDescription>
              Resellable units go back to stock at their original cost. Damaged units do not; their cost is booked as a loss.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Returnable</TableHead>
                  <TableHead className="text-right">Resellable</TableHead>
                  <TableHead className="text-right">Damaged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l: any) => (
                  <TableRow key={l.itemId}>
                    <TableCell><div className="font-medium">{l.product.name}</div><div className="text-xs text-muted-foreground">{l.product.sku}</div></TableCell>
                    <TableCell className="text-right">{l.delivered}</TableCell>
                    <TableCell className="text-right">{l.returned || "-"}</TableCell>
                    <TableCell className="text-right font-medium">{l.returnable}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min="0" disabled={l.returnable === 0} className="ml-auto h-8 w-20 text-right" value={rows[l.itemId]?.good ?? ""} onChange={(e) => set(l.itemId, { good: e.target.value })} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min="0" disabled={l.returnable === 0} className="ml-auto h-8 w-20 text-right" value={rows[l.itemId]?.damaged ?? ""} onChange={(e) => set(l.itemId, { damaged: e.target.value })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {order && (
        <Card>
          <CardHeader><CardTitle>Reason and settlement</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong size, broken packaging, customer changed mind" />
            </div>
            <div className="space-y-1"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="rounded-md border p-4 text-sm">
              <div className="flex justify-between"><span>Goods ({units} unit(s), after line discounts)</span><span>{formatCurrency(amountCents / 100)}</span></div>
              {shareCents(order.discount) > 0 && <div className="flex justify-between text-green-600"><span>Share of order discount</span><span>-{formatCurrency(shareCents(order.discount) / 100)}</span></div>}
              {shareCents(order.tax) > 0 && <div className="flex justify-between"><span>Share of tax</span><span>{formatCurrency(shareCents(order.tax) / 100)}</span></div>}
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Credit note (approx.)</span><span>{formatCurrency(creditCents / 100)}</span></div>
            </div>
            {canRefund && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={refundNow}
                  onCheckedChange={(c) => {
                    setRefundNow(c === true)
                    if (c === true && !refundAmount) setRefundAmount((creditCents / 100).toFixed(2))
                  }}
                />
                Pay the money back now (otherwise the credit reduces what the customer owes)
              </label>
            )}
            {refundNow && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1"><Label>Refund amount *</Label><Input type="number" min="0" step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} /></div>
                <div className="space-y-1"><Label>Reference</Label><Input value={refundRef} onChange={(e) => setRefundRef(e.target.value)} /></div>
                <div className="md:col-span-2"><PaymentMethodFields value={method} onChange={setMethod} idPrefix="refund" /></div>
              </div>
            )}
            {[...errors, ...(refundError ? [refundError] : [])].length > 0 && (
              <ul className="text-sm text-destructive">{[...errors, ...(refundError ? [refundError] : [])].map((m) => <li key={m}>{m}</li>)}</ul>
            )}
            <Button className="w-full" disabled={saving || units === 0 || !reason.trim() || errors.length > 0 || !!refundError} onClick={submit}>
              {saving ? "Saving..." : `Take back ${units} unit(s) from ${order.customer?.name}`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

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
import { formatCurrency, formatUnitCost } from "@/lib/utils"
import {
  PaymentMethodFields,
  emptyPaymentMethod,
  paymentMethodBody,
  paymentMethodProblems,
  usePaymentConfig,
  type PaymentMethodValue,
} from "@/components/payment-method-fields"

const cents = (v: unknown) => Math.round(Number(v || 0) * 100)

export default function NewPurchaseReturnPage() {
  const router = useRouter()
  const { toast } = useToast()
  const canRefund = useCan("supplier_payments", "create")
  const paymentConfig = usePaymentConfig()
  const [orders, setOrders] = useState<any[]>([])
  const [poId, setPoId] = useState("")
  const [po, setPo] = useState<any | null>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [refundNow, setRefundNow] = useState(false)
  const [refundAmount, setRefundAmount] = useState("")
  const [refundRef, setRefundRef] = useState("")
  const [method, setMethod] = useState<PaymentMethodValue>(emptyPaymentMethod("CASH"))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("po")
    if (fromUrl) setPoId(fromUrl)
    fetch("/api/purchase-orders").then(async (r) => {
      if (!r.ok) return
      const data = await r.json()
      setOrders(data.filter((o: any) => o.status === "PARTIALLY_RECEIVED" || o.status === "CONFIRMED"))
    })
  }, [])

  useEffect(() => {
    if (!poId) return setPo(null)
    fetch(`/api/purchase-orders/${poId}/returnable`).then(async (r) => {
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast({ title: "Error", description: data.error || "Failed to load the order", variant: "destructive" })
        return setPo(null)
      }
      setPo(data)
      setQty({})
    })
  }, [poId, toast])

  const lines = po?.lines ?? []
  const errors: string[] = lines.flatMap((l: any) => {
    const raw = qty[l.itemId]
    if (!raw) return []
    const q = Number(raw)
    if (!Number.isInteger(q) || q < 0) return [`${l.product.name}: whole numbers only`]
    if (q > l.returnable) return [`${l.product.name}: only ${l.returnable} received unit(s) can be returned`]
    if (q > l.available) return [`${l.product.name}: only ${l.available} unit(s) available in the warehouse (others are reserved or sold)`]
    return []
  })
  const goodsCents = lines.reduce((s: number, l: any) => s + cents(l.unitPrice) * (Number(qty[l.itemId]) || 0), 0)
  const subtotalCents = cents(po?.subtotal)
  const shareCents = (v: unknown) => (subtotalCents ? Math.round((cents(v) * goodsCents) / subtotalCents) : 0)
  const creditCents = goodsCents - shareCents(po?.discount) + shareCents(po?.tax)
  const units = lines.reduce((s: number, l: any) => s + (Number(qty[l.itemId]) || 0), 0)
  const refundCents = refundNow ? cents(refundAmount) : 0
  const refundError =
    refundNow && (refundCents <= 0 || refundCents > creditCents)
      ? "The refund must be more than 0 and at most the credit"
      : refundNow
      ? paymentMethodProblems(method, paymentConfig).error
      : null

  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/purchase-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: poId,
          lines: Object.entries(qty).map(([itemId, q]) => ({ itemId, quantity: Number(q || 0) })),
          reason,
          notes,
          refund: refundNow ? { amount: refundAmount, reference: refundRef, ...paymentMethodBody(method) } : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      toast({ title: `Return ${data.returnNumber} saved`, description: "Stock went out and the supplier balance was reduced." })
      router.push(`/purchases/returns/${data.id}`)
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon"><Link href="/purchases/returns"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Return goods to a supplier</h1>
          <p className="text-muted-foreground">Only received units that are still available can be returned</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Purchase order</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Combobox
            options={orders.map((o) => ({ value: o.id, label: `${o.orderNumber} - ${o.supplier?.name ?? ""}` }))}
            value={poId}
            onValueChange={setPoId}
            placeholder={po ? `${po.orderNumber} - ${po.supplier?.name}` : "Select a received purchase order"}
            searchPlaceholder="Search orders..."
            emptyMessage="No received purchase orders."
          />
          {po && <p className="text-sm text-muted-foreground">Supplier {po.supplier?.name} · warehouse {po.warehouse?.name}</p>}
        </CardContent>
      </Card>

      {po && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Lines</CardTitle>
                <CardDescription>Stock leaves at the warehouse average cost; the supplier is credited at the purchase price.</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQty(Object.fromEntries(lines.filter((l: any) => Math.min(l.returnable, l.available) > 0).map((l: any) => [l.itemId, String(Math.min(l.returnable, l.available))])))}
                >
                  Return all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setQty({})}>Clear</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Returnable</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  {lines.some((l: any) => l.avgCost !== undefined) && <TableHead className="text-right">Avg cost</TableHead>}
                  <TableHead className="text-right">Return now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l: any) => (
                  <TableRow key={l.itemId}>
                    <TableCell><div className="font-medium">{l.product.name}</div><div className="text-xs text-muted-foreground">{l.product.sku}</div></TableCell>
                    <TableCell className="text-right">{l.received}</TableCell>
                    <TableCell className="text-right">{l.returned || "-"}</TableCell>
                    <TableCell className="text-right font-medium">{l.returnable}</TableCell>
                    <TableCell className="text-right">{l.available}</TableCell>
                    <TableCell className="text-right">{formatCurrency(l.unitPrice)}</TableCell>
                    {l.avgCost !== undefined && <TableCell className="text-right">{formatUnitCost(l.avgCost)}</TableCell>}
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        max={l.returnable}
                        disabled={l.returnable === 0}
                        className="ml-auto h-8 w-24 text-right"
                        value={qty[l.itemId] ?? ""}
                        onChange={(e) => setQty({ ...qty, [l.itemId]: e.target.value })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {po && (
        <Card>
          <CardHeader><CardTitle>Reason and settlement</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged on arrival, wrong item, expired" />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="rounded-md border p-4 text-sm">
              <div className="flex justify-between"><span>Goods ({units} unit(s))</span><span>{formatCurrency(goodsCents / 100)}</span></div>
              {shareCents(po.discount) > 0 && <div className="flex justify-between text-green-600"><span>Share of order discount</span><span>-{formatCurrency(shareCents(po.discount) / 100)}</span></div>}
              {shareCents(po.tax) > 0 && <div className="flex justify-between"><span>Share of tax</span><span>{formatCurrency(shareCents(po.tax) / 100)}</span></div>}
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Supplier credit</span><span>{formatCurrency(creditCents / 100)}</span></div>
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
                The supplier refunds money now (otherwise the credit stays on the supplier account)
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
              {saving ? "Saving..." : `Return ${units} unit(s) to ${po.supplier?.name}`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

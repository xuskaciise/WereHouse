"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useParams, useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Pencil, Printer, Trash2, Truck, Unlock, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"
import { formatCurrency, formatDate } from "@/lib/utils"
import { discountLabel } from "@/lib/discount-rules"
import { taxLabel } from "@/lib/tax-rules"
import { SALES_EVENTS, SALES_STATUS, isOpenSalesStatus } from "@/lib/sales-labels"

const when = (d: string | null | undefined) => (d ? `${formatDate(d)} ${new Date(d).toLocaleTimeString()}` : "")

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const seesCost = useCan("product_cost", "view")

  const [o, setO] = useState<any | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [deliverOpen, setDeliverOpen] = useState(false)
  const [deliver, setDeliver] = useState<Record<string, string>>({})
  const [deliverNotes, setDeliverNotes] = useState("")
  const [reasonDialog, setReasonDialog] = useState<null | "cancel" | "release" | "extend">(null)
  const [reason, setReason] = useState("")
  const [until, setUntil] = useState("")

  const load = useCallback(async () => {
    const res = await fetch(`/api/sales-orders/${id}`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) setO(data)
    else setError(data.error || "Failed to load the sales order")
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  const call = async (path: string, method: string, body?: unknown, success?: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/sales-orders/${id}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      if (success) toast({ title: success })
      if (method === "DELETE") {
        router.push("/sales")
        return true
      }
      setO(data)
      return true
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="py-12 text-center text-destructive">{error}</p>
  if (!o) return <p className="py-12 text-center text-muted-foreground">Loading...</p>

  const may = (action: string) => o.allowedActions?.includes(action)
  const status = SALES_STATUS[o.status]
  const open = isOpenSalesStatus(o.status)
  const paid = (o.customerPayments ?? []).reduce((sum: number, p: any) => sum + Number(p.amount), 0)

  const openDeliver = () => {
    setDeliver(Object.fromEntries(o.items.filter((i: any) => i.remainingQuantity > 0).map((i: any) => [i.id, String(i.remainingQuantity)])))
    setDeliverNotes("")
    setDeliverOpen(true)
  }
  const deliverErrors = o.items.flatMap((i: any) => {
    const raw = deliver[i.id]
    if (raw === undefined) return []
    const q = Number(raw || 0)
    if (!Number.isInteger(q) || q < 0) return [`${i.product?.name}: whole numbers only`]
    if (q > i.remainingQuantity) return [`${i.product?.name}: only ${i.remainingQuantity} left to deliver`]
    return []
  })
  const deliverCount = Object.values(deliver).reduce((sum, v) => sum + (Number(v) || 0), 0)

  const openReason = (kind: "cancel" | "release" | "extend") => {
    setReason("")
    const base = o.reservedUntil && new Date(o.reservedUntil) > new Date() ? new Date(o.reservedUntil) : new Date()
    setUntil(new Date(base.getTime() + 7 * 86400000).toISOString().slice(0, 10))
    setReasonDialog(kind)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Button asChild variant="ghost">
          <Link href="/sales"><ArrowLeft className="mr-2 h-4 w-4" /> Sales orders</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {may("confirm") && (
            <Button onClick={() => call("/confirm", "POST", undefined, "Confirmed - stock reserved")} disabled={busy}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm (reserve)
            </Button>
          )}
          {may("deliver") && (
            <Button onClick={openDeliver} disabled={busy}>
              <Truck className="mr-2 h-4 w-4" /> Deliver
            </Button>
          )}
          {may("edit") && (o.status === "DRAFT" || o.items.every((i: any) => i.deliveredQuantity === 0)) && (
            <Button asChild variant="outline">
              <Link href={`/sales/new?edit=${o.id}`}><Pencil className="mr-2 h-4 w-4" /> Edit</Link>
            </Button>
          )}
          {may("extend") && (
            <Button variant="outline" onClick={() => openReason("extend")} disabled={busy}>
              <CalendarClock className="mr-2 h-4 w-4" /> Extend reservation
            </Button>
          )}
          {may("release") && (
            <Button variant="outline" onClick={() => openReason("release")} disabled={busy}>
              <Unlock className="mr-2 h-4 w-4" /> Release reservation
            </Button>
          )}
          {may("cancel") && (
            <Button variant="outline" onClick={() => openReason("cancel")} disabled={busy}>
              <X className="mr-2 h-4 w-4" /> {o.status === "PARTIALLY_DELIVERED" ? "Close (release rest)" : "Cancel order"}
            </Button>
          )}
          {may("delete") && (
            <Button
              variant="ghost"
              onClick={() => window.confirm(`Delete draft ${o.orderNumber}?`) && call("", "DELETE", undefined, "Draft deleted")}
              disabled={busy}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete draft
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print invoice
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">
                {o.orderNumber} <Badge variant={status?.variant} className="ml-2 align-middle">{status?.label}</Badge>
                {o.reservationExpired && <Badge variant="destructive" className="ml-2 align-middle">Reservation expired</Badge>}
              </CardTitle>
              <CardDescription className="mt-1 text-base">
                {o.customer?.name} · {o.warehouse?.name}
              </CardDescription>
              <p className="mt-1 text-sm text-muted-foreground">
                Ordered {formatDate(o.orderDate)} by {o.user?.username}
                {o.expectedDeliveryDate && ` · expected ${formatDate(o.expectedDeliveryDate)}`}
                {open && o.reservedUntil && ` · reserved until ${formatDate(o.reservedUntil)}`}
                {o.deliveredAt && ` · delivered ${formatDate(o.deliveredAt)}`}
              </p>
              {o.notes && <p className="mt-1 text-sm">{o.notes}</p>}
              {o.cancelReason && (
                <p className="mt-1 text-sm text-destructive">
                  {o.status === "CANCELLED" ? "Cancelled" : "Closed"}: {o.cancelReason}
                </p>
              )}
            </div>
            <Image src="/siu_logo.png" alt="SIU" width={64} height={64} className="h-14 w-auto" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {o.reservationExpired && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm print:hidden">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
              The reservation expired on {formatDate(o.reservedUntil)}. The stock is still held for this order until someone
              delivers, extends or releases it.
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right print:hidden">Released</TableHead>
                  <TableHead className="text-right print:hidden">{open ? "Reserved" : "Remaining"}</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {seesCost && <TableHead className="text-right print:hidden">Unit cost</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.items.map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div className="font-medium">{i.product?.name}</div>
                      <div className="text-xs text-muted-foreground">{i.product?.sku}</div>
                    </TableCell>
                    <TableCell className="text-right">{i.quantity}</TableCell>
                    <TableCell className="text-right">{i.deliveredQuantity}</TableCell>
                    <TableCell className="text-right print:hidden">{i.releasedQuantity || "-"}</TableCell>
                    <TableCell className="text-right font-medium print:hidden">{o.status === "DRAFT" ? "-" : i.remainingQuantity || "-"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(i.unitPrice)}</TableCell>
                    <TableCell className="text-right">
                      {Number(i.discountAmount) > 0
                        ? `-${formatCurrency(i.discountAmount)}${discountLabel(i.discountType, i.discountValue) ? ` (${discountLabel(i.discountType, i.discountValue)})` : ""}`
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(i.subtotal)}</TableCell>
                    {seesCost && <TableCell className="text-right print:hidden">{i.deliveredQuantity > 0 ? formatCurrency(i.unitCost) : "-"}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="ml-auto max-w-sm space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal (after item discounts)</span><span>{formatCurrency(o.subtotal)}</span></div>
            {Number(o.discount) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Order discount{discountLabel(o.discountType, o.discountValue) && ` (${discountLabel(o.discountType, o.discountValue)})`}</span>
                <span>-{formatCurrency(o.discount)}</span>
              </div>
            )}
            {Number(o.tax) !== 0 && <div className="flex justify-between"><span>{taxLabel(o.taxRate)}</span><span>{formatCurrency(o.tax)}</span></div>}
            <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{formatCurrency(o.total)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Delivered (invoiced)</span><span>{formatCurrency(o.deliveredTotal)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Paid</span><span>{formatCurrency(paid)}</span></div>
          </div>
          {o.discountReason && <p className="text-sm text-muted-foreground">Discount reason: {o.discountReason}</p>}
          <div className="hidden grid-cols-2 gap-8 pt-8 text-sm print:grid">
            <div className="border-t pt-2">Issued by (name / signature / date)</div>
            <div className="border-t pt-2">Received by customer (name / signature / date)</div>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Deliveries</CardTitle>
          <CardDescription>Revenue, customer debt and cost of goods sold are recorded per delivery.</CardDescription>
        </CardHeader>
        <CardContent>
          {o.deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing delivered yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {seesCost && <TableHead className="text-right">COGS</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.deliveries.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.deliveryNumber}{d.notes && <div className="text-xs text-muted-foreground">{d.notes}</div>}</TableCell>
                    <TableCell>{when(d.deliveredAt)}</TableCell>
                    <TableCell>{d.user?.username}</TableCell>
                    <TableCell className="text-right">{d.items.reduce((s: number, x: any) => s + x.quantity, 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(d.total)}</TableCell>
                    {seesCost && <TableCell className="text-right">{formatCurrency(d.cogs)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {o.customerPayments.length > 0 && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.customerPayments.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.paymentDate)}</TableCell>
                    <TableCell>{String(p.paymentMethod).replace(/_/g, " ")}</TableCell>
                    <TableCell>{p.reference || "-"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 border-l pl-4">
            {o.events.map((e: any) => (
              <li key={e.id} className="text-sm">
                <div className="font-medium">{SALES_EVENTS[e.type] ?? e.type}</div>
                <div className="text-muted-foreground">
                  {when(e.createdAt)} · {e.user?.username}
                  {e.data?.deliveryNumber && ` · ${e.data.deliveryNumber} (${formatCurrency(e.data.total)})`}
                  {e.data?.reservedUntil && ` · until ${formatDate(e.data.reservedUntil)}`}
                  {e.data?.to && ` · until ${formatDate(e.data.to)}`}
                  {e.data?.before && e.data?.after && ` · ${formatCurrency(e.data.before)} → ${formatCurrency(e.data.after)}`}
                </div>
                {e.notes && <div>{e.notes}</div>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Deliver {o.orderNumber}</DialogTitle>
            <DialogDescription>
              Enter what leaves the warehouse now. Anything left stays reserved and can be delivered later.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Deliver now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.items.filter((i: any) => i.remainingQuantity > 0).map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell>{i.product?.name}</TableCell>
                  <TableCell className="text-right">{i.remainingQuantity}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      max={i.remainingQuantity}
                      className="ml-auto h-8 w-24 text-right"
                      value={deliver[i.id] ?? ""}
                      onChange={(e) => setDeliver({ ...deliver, [i.id]: e.target.value })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Input placeholder="Notes (optional, e.g. driver / vehicle)" value={deliverNotes} onChange={(e) => setDeliverNotes(e.target.value)} />
          {deliverErrors.length > 0 && <ul className="text-sm text-destructive">{deliverErrors.map((m: string) => <li key={m}>{m}</li>)}</ul>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>Back</Button>
            <Button
              disabled={busy || deliverErrors.length > 0 || deliverCount === 0}
              onClick={async () => {
                const lines = Object.entries(deliver).map(([itemId, q]) => ({ itemId, quantity: Number(q || 0) }))
                if (await call("/deliver", "POST", { lines, notes: deliverNotes }, "Delivered")) setDeliverOpen(false)
              }}
            >
              Deliver {deliverCount} unit(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reasonDialog !== null} onOpenChange={(v) => !v && setReasonDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonDialog === "extend" ? "Extend reservation" : reasonDialog === "release" ? "Release reservation" : o.status === "PARTIALLY_DELIVERED" ? "Close the order" : "Cancel the order"}
            </DialogTitle>
            <DialogDescription>
              {reasonDialog === "extend"
                ? "The stock stays reserved for this customer until the new date."
                : o.status === "DRAFT"
                ? "The draft is cancelled; no stock changes."
                : o.items.some((i: any) => i.deliveredQuantity > 0)
                ? "Everything not yet delivered goes back to available stock and the order is closed as delivered."
                : "The reserved stock goes back to available stock and the order is cancelled."}
            </DialogDescription>
          </DialogHeader>
          {reasonDialog === "extend" && (
            <div className="space-y-1">
              <Label>Reserved until *</Label>
              <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label>Reason *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonDialog(null)}>Back</Button>
            <Button
              variant={reasonDialog === "extend" ? "default" : "destructive"}
              disabled={busy || !reason.trim() || (reasonDialog === "extend" && !until)}
              onClick={async () => {
                const ok =
                  reasonDialog === "cancel"
                    ? await call("/cancel", "POST", { reason }, "Order cancelled")
                    : await call(
                        "/reservation",
                        "POST",
                        reasonDialog === "extend"
                          ? { action: "extend", until: new Date(`${until}T23:59:59`).toISOString(), reason }
                          : { action: "release", reason },
                        reasonDialog === "extend" ? "Reservation extended" : "Reservation released"
                      )
                if (ok) setReasonDialog(null)
              }}
            >
              {reasonDialog === "extend" ? "Extend" : reasonDialog === "release" ? "Release" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

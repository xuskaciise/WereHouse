"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CalendarClock, Eye, Unlock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { SALES_STATUS } from "@/lib/sales-labels"

// Open stock reservations of confirmed sales orders. Expired ones are never
// released automatically: a manager extends or releases them with a reason.
export default function ReservationsPage() {
  const { toast } = useToast()
  const [tab, setTab] = useState<"expired" | "all">("expired")
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ kind: "extend" | "release"; order: any } | null>(null)
  const [reason, setReason] = useState("")
  const [until, setUntil] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/sales-orders/reservations${tab === "expired" ? "?expired=1" : ""}`)
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }, [tab])
  useEffect(() => {
    load()
  }, [load])

  const open = (kind: "extend" | "release", order: any) => {
    setReason("")
    setUntil(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
    setDialog({ kind, order })
  }

  const submit = async () => {
    if (!dialog) return
    setBusy(true)
    try {
      const body =
        dialog.kind === "extend"
          ? { action: "extend", until: new Date(`${until}T23:59:59`).toISOString(), reason }
          : { action: "release", reason }
      const res = await fetch(`/api/sales-orders/${dialog.order.id}/reservation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      toast({ title: dialog.kind === "extend" ? "Reservation extended" : "Reservation released" })
      setDialog(null)
      load()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Button asChild variant="ghost" className="-ml-4">
            <Link href="/sales"><ArrowLeft className="mr-2 h-4 w-4" /> Sales orders</Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Stock reservations</h1>
          <p className="text-muted-foreground">Stock held for confirmed orders that are not fully delivered yet</p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "expired" | "all")}>
          <TabsList>
            <TabsTrigger value="expired">Expired</TabsTrigger>
            <TabsTrigger value="all">All open</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tab === "expired" ? "Expired reservations" : "Open reservations"}</CardTitle>
          <CardDescription>
            Reserved units cannot be sold, transferred or adjusted away until the order is delivered, extended or released.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Products</TableHead>
                <TableHead className="text-right">Reserved units</TableHead>
                <TableHead className="text-right">Order total</TableHead>
                <TableHead>Reserved until</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {tab === "expired" ? "No expired reservations." : "No open reservations."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      {o.orderNumber}
                      <div><Badge variant={SALES_STATUS[o.status]?.variant}>{SALES_STATUS[o.status]?.label}</Badge></div>
                    </TableCell>
                    <TableCell>{o.customer?.name}</TableCell>
                    <TableCell>{o.warehouse?.name}</TableCell>
                    <TableCell className="text-sm">
                      {o.items
                        .filter((i: any) => i.quantity - i.deliveredQuantity - i.releasedQuantity > 0)
                        .map((i: any) => `${i.product?.name} × ${i.quantity - i.deliveredQuantity - i.releasedQuantity}`)
                        .join(", ")}
                    </TableCell>
                    <TableCell className="text-right">{o.reservedUnits}</TableCell>
                    <TableCell className="text-right">{formatCurrency(o.total)}</TableCell>
                    <TableCell className={o.reservationExpired ? "font-medium text-destructive" : ""}>
                      {o.reservedUntil ? formatDate(o.reservedUntil) : "-"}
                      {o.reservationExpired && <Badge variant="destructive" className="ml-2">Expired</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button asChild variant="ghost" size="icon" title="Open order">
                        <Link href={`/sales/${o.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                      {o.allowedActions.includes("extend") && (
                        <Button variant="ghost" size="icon" title="Extend" onClick={() => open("extend", o)}>
                          <CalendarClock className="h-4 w-4" />
                        </Button>
                      )}
                      {o.allowedActions.includes("release") && (
                        <Button variant="ghost" size="icon" title="Release" onClick={() => open("release", o)}>
                          <Unlock className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === "extend" ? "Extend" : "Release"} reservation of {dialog?.order.orderNumber}</DialogTitle>
            <DialogDescription>
              {dialog?.kind === "extend"
                ? "The stock stays reserved for the customer until the new date."
                : "Everything not yet delivered goes back to available stock. With nothing delivered the order is cancelled, otherwise it is closed."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.kind === "extend" && (
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
            <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
            <Button
              variant={dialog?.kind === "extend" ? "default" : "destructive"}
              disabled={busy || !reason.trim() || (dialog?.kind === "extend" && !until)}
              onClick={submit}
            >
              {dialog?.kind === "extend" ? "Extend" : "Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

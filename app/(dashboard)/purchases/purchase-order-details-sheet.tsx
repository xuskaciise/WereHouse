"use client"

import { useState } from "react"
import { AlertTriangle, PackageCheck, Pencil, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"
import { formatCurrency, formatDate } from "@/lib/utils"
import { LandedCostsSection } from "./landed-costs-section"
import { taxLabel } from "@/lib/tax-rules"
import {
  ADJUSTMENT_REASON_MAX_LENGTH,
  purchaseStatusLabel,
} from "@/lib/purchase-rules"

export function totalReceivedForLineItem(item: { receiveItems?: { quantityReceived: number }[] }) {
  if (!item?.receiveItems?.length) return 0
  return item.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)
}

export function purchaseOrderStatusBadgeVariant(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "success" as const
    case "PARTIALLY_RECEIVED":
      return "default" as const
    case "PENDING":
      return "warning" as const
    default:
      return "secondary" as const
  }
}

function canReceivePurchaseOrder(order: { status?: string }) {
  return order?.status === "PENDING" || order?.status === "PARTIALLY_RECEIVED"
}

function canEditPurchaseOrder(order: { status?: string; receives?: unknown[] }) {
  return order?.status === "PENDING" && !(order.receives?.length)
}

// Preview only (the server recalculates): integer cents, same rounding as
// the server (half-up per line and on the tax), at the order's own stored
// tax rate.
const cents = (value: unknown) => Math.round(Number(value || 0) * 100)

function previewTotalCents(order: any, quantityById: Record<string, number>) {
  const subtotal = (order.items || []).reduce(
    (sum: number, item: any) => sum + cents(item.unitPrice) * (quantityById[item.id] ?? item.quantity),
    0
  )
  return subtotal + Math.round((subtotal * Number(order.taxRate || 0)) / 100) - cents(order.discount)
}

function formatDelta(deltaCents: number) {
  return formatCurrency(Math.abs(deltaCents) / 100)
}

const ADJUSTMENT_LABELS: Record<string, string> = {
  EDIT: "Quantity edited",
  OVER_RECEIVE: "Over-received",
  CLOSE_REMAINING: "Remainder closed",
}

interface ReceiveRow {
  qty: string
  close: boolean
  reason: string
}

export function PurchaseOrderDetailsSheet({
  order,
  open,
  onOpenChange,
  onReceiveComplete,
}: {
  order: any
  open: boolean
  onOpenChange: (open: boolean) => void
  onReceiveComplete: (orderId: string) => void | Promise<void>
}) {
  const { toast } = useToast()
  // Same permissions the API checks (lib/permission-rules.ts).
  const canReceive = useCan("purchase_receive", "create")
  const canAdjust = useCan("purchase_receive", "edit")
  const canEditOrder = useCan("purchases", "edit")
  const canViewLandedCosts = useCan("landed_costs", "view")

  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveNote, setReceiveNote] = useState("")
  const [receiveRows, setReceiveRows] = useState<Record<string, ReceiveRow>>({})
  const [receiveSubmitting, setReceiveSubmitting] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editQty, setEditQty] = useState<Record<string, string>>({})
  const [editReason, setEditReason] = useState("")
  const [editSubmitting, setEditSubmitting] = useState(false)

  const items: any[] = order.items || []

  // --- Receive dialog -------------------------------------------------------
  const openReceiveDialog = () => {
    const init: Record<string, ReceiveRow> = {}
    for (const item of items) {
      const rem = item.closed ? 0 : Math.max(0, item.quantity - totalReceivedForLineItem(item))
      init[item.id] = { qty: String(rem), close: false, reason: "" }
    }
    setReceiveRows(init)
    setReceiveNote("")
    setReceiveOpen(true)
  }

  const updateRow = (id: string, patch: Partial<ReceiveRow>) =>
    setReceiveRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const receivePlan = items.map((item) => {
    const row = receiveRows[item.id] ?? { qty: "0", close: false, reason: "" }
    const received = totalReceivedForLineItem(item)
    const remaining = item.closed ? 0 : Math.max(0, item.quantity - received)
    const parsed = Number(row.qty)
    const invalid = row.qty.trim() !== "" && (!Number.isInteger(parsed) || parsed < 0)
    const now = invalid || row.qty.trim() === "" ? 0 : parsed
    const receivedAfter = received + now
    const over = !item.closed && receivedAfter > item.quantity
    const closing = !item.closed && !over && row.close && receivedAfter < item.quantity
    const newQuantity = over || closing ? receivedAfter : item.quantity
    const needsReason = over || closing
    return { item, row, received, remaining, now, invalid, over, closing, newQuantity, needsReason }
  })

  const currentTotalCents = previewTotalCents(order, {})
  const lineDelta = (itemId: string, newQuantity: number) =>
    previewTotalCents(order, { [itemId]: newQuantity }) - currentTotalCents
  const newTotalCents = previewTotalCents(
    order,
    Object.fromEntries(receivePlan.map((p) => [p.item.id, p.newQuantity]))
  )
  const totalDelta = newTotalCents - currentTotalCents

  const receiveErrors: string[] = []
  for (const p of receivePlan) {
    const name = p.item.product?.name || "item"
    if (p.invalid) receiveErrors.push(`${name}: enter a whole number of 0 or more`)
    if (p.needsReason && !canAdjust) {
      receiveErrors.push(
        p.over
          ? `${name}: your role cannot receive more than ordered`
          : `${name}: your role cannot close a remainder`
      )
    }
    if (p.needsReason && canAdjust && !p.row.reason.trim()) receiveErrors.push(`${name}: a reason is required`)
  }
  const hasWork = receivePlan.some((p) => p.now > 0 || p.closing)

  const submitReceive = async () => {
    if (!order?.id || receiveErrors.length > 0 || !hasWork) return
    setReceiveSubmitting(true)
    try {
      const lines = receivePlan
        .filter((p) => !p.item.closed)
        .map((p) => ({
          purchaseOrderItemId: p.item.id,
          quantityReceived: p.now,
          closeRemaining: p.closing,
          reason: p.needsReason ? p.row.reason.trim() : undefined,
        }))
      const res = await fetch(`/api/purchase-orders/${order.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, notes: receiveNote.trim() || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Receive failed")
      }
      toast({
        title: "Goods received",
        description: "Warehouse stock, movements and order totals have been updated.",
      })
      setReceiveOpen(false)
      await onReceiveComplete(order.id)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to receive order"
      toast({ title: "Error", description: message, variant: "destructive" })
    } finally {
      setReceiveSubmitting(false)
    }
  }

  // --- Edit quantities (before the first receive) ----------------------------
  const openEditDialog = () => {
    setEditQty(Object.fromEntries(items.map((item) => [item.id, String(item.quantity)])))
    setEditReason("")
    setEditOpen(true)
  }

  const editPlan = items.map((item) => {
    const raw = editQty[item.id] ?? String(item.quantity)
    const parsed = Number(raw)
    const valid = raw.trim() !== "" && Number.isInteger(parsed) && parsed >= 1
    return { item, valid, quantity: valid ? parsed : item.quantity }
  })
  const editValid = editPlan.every((p) => p.valid)
  const editChanged = editPlan.some((p) => p.quantity !== p.item.quantity)
  const editTotalCents = previewTotalCents(
    order,
    Object.fromEntries(editPlan.map((p) => [p.item.id, p.quantity]))
  )

  const submitEdit = async () => {
    if (!order?.id || !editValid || !editChanged) return
    setEditSubmitting(true)
    try {
      const res = await fetch(`/api/purchase-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: editPlan.filter((p) => p.quantity !== p.item.quantity).map((p) => ({ id: p.item.id, quantity: p.quantity })),
          reason: editReason.trim() || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Update failed")
      }
      toast({ title: "Quantities updated", description: "Line and order totals have been recalculated." })
      setEditOpen(false)
      await onReceiveComplete(order.id)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update quantities"
      toast({ title: "Error", description: message, variant: "destructive" })
    } finally {
      setEditSubmitting(false)
    }
  }

  // --- History ----------------------------------------------------------------
  const history = [
    ...items.flatMap((item) =>
      (item.adjustments || []).map((a: any) => ({
        id: a.id,
        createdAt: a.createdAt,
        user: a.user,
        title: `${ADJUSTMENT_LABELS[a.type] || a.type}: ${item.product?.name || "item"} ${a.oldQuantity} → ${a.newQuantity}`,
        text: a.reason as string | null,
      }))
    ),
    ...(order.receives || [])
      .filter((r: any) => r.notes)
      .map((r: any) => ({
        id: r.id,
        createdAt: r.createdAt,
        user: r.user,
        title: "Receive note",
        text: r.notes as string,
      })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <div id="purchase-order-print-root" className="space-y-6 pt-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pr-6">
              <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-4 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/siu_logo.png"
                  alt="SIU"
                  className="h-12 w-auto max-w-[200px] object-contain object-left"
                />
                <div className="min-w-0 text-left">
                  <SheetTitle className="text-left text-xl font-semibold leading-tight">
                    Purchase Order: {order.orderNumber}
                  </SheetTitle>
                  <SheetDescription className="text-left mt-1">
                    View purchase order details and items
                  </SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden shrink-0">
                {canEditOrder && canEditPurchaseOrder(order) && (
                  <Button type="button" variant="outline" size="sm" onClick={openEditDialog}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit quantities
                  </Button>
                )}
                {canReceive && canReceivePurchaseOrder(order) && (
                  <Button type="button" variant="default" size="sm" onClick={openReceiveDialog}>
                    <PackageCheck className="mr-2 h-4 w-4" />
                    Receive Order
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
              </div>
            </div>
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Order Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">Supplier</h4>
                    <p className="mt-1">{order.supplier?.name || "N/A"}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">Warehouse</h4>
                    <p className="mt-1">{order.warehouse?.name || "N/A"}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">Order Date</h4>
                    <p className="mt-1">{formatDate(order.orderDate)}</p>
                  </div>
                  {order.expectedDeliveryDate && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground">Expected Delivery</h4>
                      <p className="mt-1">{formatDate(order.expectedDeliveryDate)}</p>
                    </div>
                  )}
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">Status</h4>
                    <p className="mt-1">
                      <Badge variant={purchaseOrderStatusBadgeVariant(order.status)}>
                        {purchaseStatusLabel(order.status)}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">Created By</h4>
                    <p className="mt-1">{order.user?.username || order.user?.name || "N/A"}</p>
                  </div>
                </div>
                {order.notes && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">Notes</h4>
                    <p className="mt-1">{order.notes}</p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Order Items</h3>
                {items.length > 0 ? (
                  <div className="border rounded-lg overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Ordered</TableHead>
                          <TableHead className="text-right">Adjusted</TableHead>
                          <TableHead className="text-right">Received</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item: any) => {
                          const recv = totalReceivedForLineItem(item)
                          const rem = item.closed ? 0 : Math.max(0, item.quantity - recv)
                          const original = item.originalQuantity ?? item.quantity
                          const overReceived = (item.adjustments || []).some((a: any) => a.type === "OVER_RECEIVE")
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                <div>{item.product?.name || "N/A"}</div>
                                <div className="text-xs text-muted-foreground">{item.product?.sku || ""}</div>
                                {(overReceived || item.closed) && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {overReceived && <Badge variant="warning">Over-received</Badge>}
                                    {item.closed && <Badge variant="secondary">Closed</Badge>}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">{original}</TableCell>
                              <TableCell
                                className={`text-right ${item.quantity !== original ? "font-semibold" : "text-muted-foreground"}`}
                              >
                                {item.quantity}
                              </TableCell>
                              <TableCell className="text-right">{recv}</TableCell>
                              <TableCell className="text-right">{rem}</TableCell>
                              <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(item.subtotal ?? item.quantity * item.unitPrice)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No items found</p>
                )}
              </div>

              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-semibold">Order Summary</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">{formatCurrency(order.subtotal || 0)}</span>
                  </div>
                  {Number(order.tax) !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{taxLabel(order.taxRate)}</span>
                      <span className="font-medium">{formatCurrency(order.tax || 0)}</span>
                    </div>
                  )}
                  {order.discount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Discount</span>
                      <span className="font-medium text-green-600">-{formatCurrency(order.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total</span>
                    <span className="text-primary">{formatCurrency(order.total || 0)}</span>
                  </div>
                </div>
              </div>

              {canViewLandedCosts && <LandedCostsSection key={order.updatedAt} purchaseOrderId={order.id} />}

              {history.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-lg font-semibold">Notes history</h3>
                  <ul className="space-y-3">
                    {history.map((entry) => (
                      <li key={entry.id} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-medium">{entry.title}</span>
                          <span className="text-muted-foreground">
                            {formatDate(entry.createdAt)} · {entry.user?.username || entry.user?.name || "N/A"}
                          </span>
                        </div>
                        {entry.text && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{entry.text}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receive goods — {order.orderNumber}</DialogTitle>
            <DialogDescription>
              Enter quantities actually received at {order.warehouse?.name || "the warehouse"}. Stock
              updates only after you confirm.
              {canAdjust
                ? " You may receive more than ordered, or close a remainder the supplier will not deliver."
                : " Your role cannot receive more than ordered or close a remainder."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right w-28">Receive now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivePlan.map((p) => {
                  const { item, row } = p
                  const delta = lineDelta(item.id, p.newQuantity)
                  const canClose = canAdjust && !item.closed && !p.over && p.received + p.now < item.quantity
                  return (
                    <TableRow key={item.id} className="align-top">
                      <TableCell className="text-sm">
                        <div className="font-medium">{item.product?.name || "N/A"}</div>
                        {item.closed && <Badge variant="secondary" className="mt-1">Closed</Badge>}
                        {canClose && (
                          <label className="mt-2 flex items-center gap-2 text-xs font-normal">
                            <Checkbox
                              checked={row.close}
                              onCheckedChange={(checked) => updateRow(item.id, { close: checked === true })}
                            />
                            Close remaining (supplier will not deliver the rest)
                          </label>
                        )}
                        {p.over && (
                          <p className="mt-2 flex items-start gap-1 text-xs text-yellow-700 dark:text-yellow-500">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            Receiving {p.received + p.now - item.quantity} more than ordered — the order total
                            will increase by {formatDelta(delta)}
                          </p>
                        )}
                        {p.closing && (
                          <p className="mt-2 flex items-start gap-1 text-xs text-yellow-700 dark:text-yellow-500">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            Closing {item.quantity - p.newQuantity} not delivered — the order total will decrease
                            by {formatDelta(delta)}
                          </p>
                        )}
                        {p.needsReason && canAdjust && (
                          <Input
                            className="mt-2 h-8 text-xs"
                            placeholder="Reason (required)"
                            maxLength={ADJUSTMENT_REASON_MAX_LENGTH}
                            value={row.reason}
                            onChange={(e) => updateRow(item.id, { reason: e.target.value })}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{item.quantity}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.received}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.remaining}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          max={canAdjust ? undefined : p.remaining}
                          className="h-8 w-24 text-right ml-auto"
                          disabled={item.closed || (!canAdjust && p.remaining <= 0)}
                          value={row.qty}
                          onChange={(e) => updateRow(item.id, { qty: e.target.value })}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {totalDelta !== 0 && (
              <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
                Order total: {formatCurrency(currentTotalCents / 100)} → {" "}
                <span className="font-semibold">{formatCurrency(newTotalCents / 100)}</span> (
                {totalDelta > 0 ? "+" : "−"}
                {formatDelta(totalDelta)}). The supplier balance changes by the same amount.
              </div>
            )}
            {receiveErrors.length > 0 && (
              <ul className="space-y-1 text-sm text-destructive">
                {receiveErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <Label htmlFor="receive-note">Receiving notes (optional)</Label>
              <Textarea
                id="receive-note"
                value={receiveNote}
                onChange={(e) => setReceiveNote(e.target.value)}
                placeholder="Delivery reference, condition, etc."
                maxLength={ADJUSTMENT_REASON_MAX_LENGTH}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReceiveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitReceive}
              disabled={receiveSubmitting || receiveErrors.length > 0 || !hasWork}
            >
              {receiveSubmitting ? "Saving…" : "Confirm receive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit quantities — {order.orderNumber}</DialogTitle>
            <DialogDescription>
              Possible only until the first goods are received. Line and order totals are recalculated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right w-28">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editPlan.map((p) => (
                  <TableRow key={p.item.id}>
                    <TableCell className="font-medium text-sm">{p.item.product?.name || "N/A"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(p.item.unitPrice)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        className={`h-8 w-24 text-right ml-auto ${p.valid ? "" : "border-destructive"}`}
                        value={editQty[p.item.id] ?? ""}
                        onChange={(e) => setEditQty((prev) => ({ ...prev, [p.item.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!editValid && <p className="text-sm text-destructive">Each quantity must be a whole number of at least 1.</p>}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">New order total</span>
              <span className="font-semibold">{formatCurrency(editTotalCents / 100)}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-reason">Reason (optional)</Label>
              <Textarea
                id="edit-reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                maxLength={ADJUSTMENT_REASON_MAX_LENGTH}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitEdit} disabled={editSubmitting || !editValid || !editChanged}>
              {editSubmitting ? "Saving…" : "Save quantities"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

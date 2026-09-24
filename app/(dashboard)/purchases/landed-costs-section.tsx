"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { FileText, Lock, LockOpen, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCan, useCurrentUser } from "@/components/providers/current-user-provider"
import { formatCurrency, formatDate, formatUnitCost } from "@/lib/utils"
import { PaymentMethodFields, emptyPaymentMethod, paymentMethodBody, paymentMethodProblems, usePaymentConfig, type PaymentMethodValue } from "@/components/payment-method-fields"

export const METHOD_LABELS: Record<string, string> = {
  VALUE: "By value",
  QUANTITY: "By quantity",
  WEIGHT: "By weight",
  VOLUME: "By volume",
  MANUAL: "Manual per item",
}
const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = {
  PAID: "success",
  PARTLY_PAID: "warning",
  UNPAID: "secondary",
}
export const unit4 = (n: unknown) => formatUnitCost(n as number)

interface CostForm {
  typeId: string
  paidToSupplierId: string
  amountType: "FIXED" | "PERCENT"
  value: string
  percentBase: "GOODS" | "GOODS_PLUS_FIXED"
  allocationMethod: string
  manual: Record<string, string>
  reference: string
  costDate: string
  notes: string
  reason: string
  paidNow: boolean
}

const emptyForm = (): CostForm => ({
  typeId: "",
  paidToSupplierId: "",
  amountType: "FIXED",
  value: "",
  percentBase: "GOODS",
  allocationMethod: "VALUE",
  manual: {},
  reference: "",
  costDate: new Date().toISOString().slice(0, 10),
  notes: "",
  reason: "",
  paidNow: false,
})

function toBody(form: CostForm) {
  return {
    typeId: form.typeId,
    paidToSupplierId: form.paidToSupplierId,
    amountType: form.amountType,
    value: form.value,
    percentBase: form.percentBase,
    allocationMethod: form.allocationMethod,
    manual:
      form.allocationMethod === "MANUAL"
        ? Object.entries(form.manual).map(([itemId, amount]) => ({ itemId, amount: amount || "0" }))
        : undefined,
    reference: form.reference,
    costDate: form.costDate,
    notes: form.notes,
  }
}

/** "Additional costs" of a purchase order (shown inside the PO details sheet). */
export function LandedCostsSection({ purchaseOrderId }: { purchaseOrderId: string }) {
  const { toast } = useToast()
  const currentUser = useCurrentUser()
  const canCreate = useCan("landed_costs", "create")
  const canEdit = useCan("landed_costs", "edit")
  const canDelete = useCan("landed_costs", "delete")
  const canFinalize = useCan("landed_costs_admin", "edit")
  const canPay = useCan("supplier_payments", "create")
  const seesCost = useCan("product_cost", "view")
  const isAdmin = currentUser.role === "ADMIN"

  const [view, setView] = useState<any | null>(null)
  const [types, setTypes] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [dialog, setDialog] = useState<{ open: boolean; cost: any | null }>({ open: false, cost: null })
  const [form, setForm] = useState<CostForm>(emptyForm)
  const [preview, setPreview] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const paymentConfig = usePaymentConfig()
  const [paidMethod, setPaidMethod] = useState<PaymentMethodValue>(emptyPaymentMethod("BANK_TRANSFER"))
  const [reopenReason, setReopenReason] = useState("")
  const [reopenOpen, setReopenOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleteReason, setDeleteReason] = useState("")

  const finalized = !!view?.purchaseOrder?.costsFinalizedAt
  // After "Costs finalized" only an admin can change costs (with a reason).
  const editable = !finalized || isAdmin

  const load = useCallback(async () => {
    const res = await fetch(`/api/purchase-orders/${purchaseOrderId}/landed-costs`)
    if (res.ok) setView(await res.json())
  }, [purchaseOrderId])

  useEffect(() => {
    load()
  }, [load])

  const openForm = async (cost: any | null) => {
    if (types.length === 0) {
      const res = await fetch("/api/landed-cost-types")
      if (res.ok) setTypes(await res.json())
    }
    if (suppliers.length === 0) {
      const res = await fetch("/api/suppliers")
      if (res.ok) setSuppliers(await res.json())
    }
    setForm(
      cost
        ? {
            ...emptyForm(),
            typeId: cost.typeId,
            paidToSupplierId: cost.paidToSupplierId,
            amountType: cost.amountType,
            value: String(cost.value),
            percentBase: cost.percentBase,
            allocationMethod: cost.allocationMethod,
            manual: Object.fromEntries(
              (cost.allocations || []).filter((a: any) => a.manualAmount !== null).map((a: any) => [a.purchaseOrderItemId, String(a.manualAmount)])
            ),
            reference: cost.reference || "",
            costDate: String(cost.costDate).slice(0, 10),
            notes: cost.notes || "",
          }
        : emptyForm()
    )
    setPreview(null)
    setDialog({ open: true, cost })
  }

  // Live preview: the server computes the allocation exactly as it will save it.
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!dialog.open || !form.typeId || !form.paidToSupplierId || !form.value) {
      setPreview(null)
      return
    }
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/purchase-orders/${purchaseOrderId}/landed-costs/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costId: dialog.cost?.id ?? null, cost: toBody(form) }),
      })
      if (res.ok) setPreview(await res.json())
    }, 350)
  }, [dialog, form, purchaseOrderId])

  const save = async () => {
    setSaving(true)
    try {
      const url = dialog.cost
        ? `/api/purchase-orders/${purchaseOrderId}/landed-costs/${dialog.cost.id}`
        : `/api/purchase-orders/${purchaseOrderId}/landed-costs`
      const res = await fetch(url, {
        method: dialog.cost ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toBody(form),
          reason: form.reason || undefined,
          paidNow: !dialog.cost && form.paidNow ? paymentMethodBody(paidMethod) : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to save the cost")
      setView(data)
      setDialog({ open: false, cost: null })
      toast({ title: dialog.cost ? "Cost updated" : "Cost added", description: "Allocation and product costs were recalculated." })
      for (const warning of data.warnings ?? []) toast({ title: "Please check", description: warning })
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    const res = await fetch(`/api/purchase-orders/${purchaseOrderId}/landed-costs/${deleteTarget.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: deleteReason || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Cannot delete", description: data.error || "Failed", variant: "destructive" })
      return
    }
    setView(data)
    setDeleteTarget(null)
    setDeleteReason("")
    toast({ title: "Cost deleted" })
  }

  const setFinalized = async (finalizedValue: boolean) => {
    const res = await fetch(`/api/purchase-orders/${purchaseOrderId}/landed-costs/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finalized: finalizedValue, reason: reopenReason || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Error", description: data.error || "Failed", variant: "destructive" })
      return
    }
    setView(data)
    setReopenOpen(false)
    setReopenReason("")
    toast({ title: finalizedValue ? "Costs finalized" : "Costs reopened" })
  }

  const serviceProvidersFirst = useMemo(
    () => [...suppliers].sort((a, b) => Number(b.type === "SERVICE_PROVIDER") - Number(a.type === "SERVICE_PROVIDER")),
    [suppliers]
  )

  if (!view) return null
  const items: any[] = view.items || []

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Additional costs</h3>
          <p className="text-sm text-muted-foreground">
            Goods {formatCurrency(view.goodsValue)} · Costs {formatCurrency(view.totalCosts)} · Uplift {Number(view.upliftPercent).toFixed(2)}%
            {finalized && (
              <>
                {" "}
                · <Badge variant="secondary">Finalized {formatDate(view.purchaseOrder.costsFinalizedAt)}</Badge>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button asChild variant="outline" size="sm">
            <Link href={`/landed-costs/${purchaseOrderId}`}>
              <FileText className="mr-2 h-4 w-4" /> Landed cost report
            </Link>
          </Button>
          {canCreate && editable && (
            <Button size="sm" onClick={() => openForm(null)}>
              <Plus className="mr-2 h-4 w-4" /> Add cost
            </Button>
          )}
          {canFinalize && !finalized && view.costs.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setFinalized(true)}>
              <Lock className="mr-2 h-4 w-4" /> Finalize costs
            </Button>
          )}
          {finalized && isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)}>
              <LockOpen className="mr-2 h-4 w-4" /> Reopen
            </Button>
          )}
        </div>
      </div>

      {view.costs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No additional costs. Shipment, customs, transport or commission can be added here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Paid to</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.costs.map((cost: any) => (
                <TableRow key={cost.id}>
                  <TableCell className="font-medium">
                    {cost.type?.name}
                    {cost.amountType === "PERCENT" && (
                      <div className="text-xs text-muted-foreground">
                        {Number(cost.value)}% of {cost.percentBase === "GOODS" ? "goods value" : "goods + fixed costs"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{cost.paidToSupplier?.name}</TableCell>
                  <TableCell className="text-right">{formatCurrency(cost.amount)}</TableCell>
                  <TableCell>{METHOD_LABELS[cost.allocationMethod]}</TableCell>
                  <TableCell>
                    {cost.reference || "-"}
                    <div className="text-xs text-muted-foreground">{formatDate(cost.costDate)}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[cost.paymentStatus]}>{cost.paymentStatus.replace("_", " ")}</Badge>
                    {Number(cost.paidAmount) > 0 && cost.paymentStatus !== "PAID" && (
                      <div className="text-xs text-muted-foreground">{formatCurrency(cost.paidAmount)} paid</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right print:hidden">
                    {canEdit && editable && (
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => openForm(cost)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && editable && (
                      <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(cost)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {seesCost && view.costs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">Cost / unit</TableHead>
                <TableHead className="text-right">Landed unit cost</TableHead>
                <TableHead className="text-right">Increase</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.product?.name}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.landedCost)}</TableCell>
                  <TableCell className="text-right">{unit4(item.costPerUnit)}</TableCell>
                  <TableCell className="text-right font-medium">{unit4(item.landedUnitCost)}</TableCell>
                  <TableCell className="text-right">{Number(item.costIncreasePercent).toFixed(2)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {view.logs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Cost change log ({view.logs.length})</summary>
          <ul className="mt-2 space-y-1">
            {view.logs.map((log: any) => (
              <li key={log.id}>
                <span className="font-medium">{log.action}</span> {log.after?.type || log.before?.type || ""}{" "}
                {log.after?.amount ? `→ ${formatCurrency(log.after.amount)}` : log.before?.amount ? `(${formatCurrency(log.before.amount)})` : ""} ·{" "}
                {log.user?.username} · {formatDate(log.createdAt)}
                {log.reason && <span className="text-muted-foreground"> · {log.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog.cost ? "Edit cost" : "Add cost"}</DialogTitle>
            <DialogDescription>
              The cost is allocated to the order lines and added to their landed unit cost. It is a payable to the
              paid-to party (not an expense).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Cost type *</Label>
              <Select value={form.typeId} onValueChange={(typeId) => setForm({ ...form, typeId })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {types.filter((t) => t.isActive || t.id === form.typeId).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Paid to *</Label>
              <Select value={form.paidToSupplierId} onValueChange={(paidToSupplierId) => setForm({ ...form, paidToSupplierId })}>
                <SelectTrigger><SelectValue placeholder="Service provider" /></SelectTrigger>
                <SelectContent>
                  {serviceProvidersFirst.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.type === "SERVICE_PROVIDER" ? " (service provider)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <div className="flex gap-2">
                <Select value={form.amountType} onValueChange={(v) => setForm({ ...form, amountType: v as CostForm["amountType"] })}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">$ fixed</SelectItem>
                    <SelectItem value="PERCENT">% of</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </div>
            </div>
            {form.amountType === "PERCENT" ? (
              <div className="space-y-2">
                <Label>Percentage of</Label>
                <Select value={form.percentBase} onValueChange={(v) => setForm({ ...form, percentBase: v as CostForm["percentBase"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GOODS">Goods value</SelectItem>
                    <SelectItem value="GOODS_PLUS_FIXED">Goods value + other fixed costs</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.costDate} onChange={(e) => setForm({ ...form, costDate: e.target.value })} />
              </div>
            )}
            <div className="space-y-2">
              <Label>Allocation</Label>
              <Select value={form.allocationMethod} onValueChange={(allocationMethod) => setForm({ ...form, allocationMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}{value === "VALUE" ? " (default)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reference / invoice no.</Label>
              <Input value={form.reference} maxLength={100} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            {form.amountType === "PERCENT" && (
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.costDate} onChange={(e) => setForm({ ...form, costDate: e.target.value })} />
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {finalized && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Reason for changing finalized costs *</Label>
                <Input value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
            )}
            {!dialog.cost && canPay && (
              <div className="space-y-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.paidNow} onCheckedChange={(c) => setForm({ ...form, paidNow: c === true })} />
                  Paid now (records a supplier payment)
                </label>
                {form.paidNow && <PaymentMethodFields value={paidMethod} onChange={setPaidMethod} idPrefix="landed-paid" />}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Allocation preview</span>
              {preview?.draftAmount !== undefined && preview?.draftAmount !== null && (
                <span>
                  This cost: <b>{formatCurrency(preview.draftAmount)}</b> · All costs {formatCurrency(preview.totalCosts)} (
                  {Number(preview.upliftPercent).toFixed(2)}%)
                </span>
              )}
            </div>
            {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">{form.allocationMethod === "MANUAL" ? "Manual amount" : "This cost"}</TableHead>
                    {seesCost && <TableHead className="text-right">Cost / unit</TableHead>}
                    {seesCost && <TableHead className="text-right">Landed unit</TableHead>}
                    {seesCost && <TableHead className="text-right">Increase</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const p = preview?.items?.find((x: any) => x.id === item.id)
                    return (
                      <TableRow key={item.id}>
                        <TableCell>{item.product?.name}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="text-right">
                          {form.allocationMethod === "MANUAL" ? (
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="ml-auto h-8 w-28 text-right"
                              value={form.manual[item.id] ?? ""}
                              onChange={(e) => setForm({ ...form, manual: { ...form.manual, [item.id]: e.target.value } })}
                            />
                          ) : p?.draftAllocation !== undefined && p?.draftAllocation !== null ? (
                            formatCurrency(p.draftAllocation)
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        {seesCost && <TableCell className="text-right">{p ? unit4(p.costPerUnit) : "-"}</TableCell>}
                        {seesCost && <TableCell className="text-right font-medium">{p ? unit4(p.landedUnitCost) : "-"}</TableCell>}
                        {seesCost && (
                          <TableCell className="text-right">{p ? `${Number(p.costIncreasePercent).toFixed(2)}%` : "-"}</TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Allocations are rounded to the cent; any rounding difference goes to the last line, so they always add up
              to the cost. Per-unit costs use 4 decimals.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, cost: null })}>Cancel</Button>
            <Button
              onClick={save}
              disabled={
                saving || !!preview?.error || !form.typeId || !form.paidToSupplierId || !form.value ||
                (!dialog.cost && form.paidNow && !!paymentMethodProblems(paidMethod, paymentConfig).error)
              }
            >
              {saving ? "Saving..." : "Save cost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.type?.name}?</DialogTitle>
            <DialogDescription>The allocation and product costs are recalculated. Paid costs cannot be deleted.</DialogDescription>
          </DialogHeader>
          {finalized && (
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen finalized costs</DialogTitle>
            <DialogDescription>Only an admin can do this; the reason is logged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button onClick={() => setFinalized(false)} disabled={!reopenReason.trim()}>Reopen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

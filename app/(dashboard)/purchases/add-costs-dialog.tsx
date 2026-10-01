"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"
import { formatCurrency } from "@/lib/utils"
import { PaymentMethodFields, emptyPaymentMethod, paymentMethodBody, paymentMethodProblems, usePaymentConfig, type PaymentMethodValue } from "@/components/payment-method-fields"

// "Add costs": several landed costs of a purchase order in one form, with a
// live preview of all rows together, saved in one transaction (all or none).
// Manual per-item allocation stays in the single "Edit cost" form.

const ALLOCATIONS: Record<string, string> = {
  VALUE: "By value",
  QUANTITY: "By quantity",
  WEIGHT: "By weight",
  VOLUME: "By volume",
}
const unit4 = (n: unknown) => Number(n ?? 0).toFixed(4)

interface Row {
  key: number
  typeId: string
  paidToSupplierId: string
  amountType: "FIXED" | "PERCENT"
  value: string
  percentBase: "GOODS" | "GOODS_PLUS_FIXED"
  allocationMethod: string
  reference: string
  costDate: string
  notes: string
}

let nextKey = 1
const today = () => new Date().toISOString().slice(0, 10)
const emptyRow = (paidTo = "", common?: Pick<Row, "reference" | "costDate">): Row => ({
  key: nextKey++,
  typeId: "",
  paidToSupplierId: paidTo,
  amountType: "FIXED",
  value: "",
  percentBase: "GOODS",
  allocationMethod: "VALUE",
  reference: common?.reference ?? "",
  costDate: common?.costDate ?? today(),
  notes: "",
})
const isBlank = (r: Row) => !r.typeId && !r.value
const toBody = (r: Row) => ({
  typeId: r.typeId,
  paidToSupplierId: r.paidToSupplierId,
  amountType: r.amountType,
  value: r.value,
  percentBase: r.percentBase,
  allocationMethod: r.allocationMethod,
  reference: r.reference,
  costDate: r.costDate,
  notes: r.notes,
})

export function AddCostsDialog({
  purchaseOrderId,
  poSupplierId,
  open,
  onOpenChange,
  finalized,
  startWithTemplates,
  onSaved,
}: {
  purchaseOrderId: string
  poSupplierId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  finalized: boolean
  /** Opened from "Apply template": show the template picker first. */
  startWithTemplates?: boolean
  onSaved: (view: any) => void
}) {
  const { toast } = useToast()
  const canPay = useCan("supplier_payments", "create")
  const seesCost = useCan("product_cost", "view")
  const paymentConfig = usePaymentConfig()
  const [types, setTypes] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [templateId, setTemplateId] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [preview, setPreview] = useState<any | null>(null)
  const [reason, setReason] = useState("")
  const [paidNow, setPaidNow] = useState(false)
  const [paidMethod, setPaidMethod] = useState<PaymentMethodValue>(emptyPaymentMethod("BANK_TRANSFER"))
  const [paidReference, setPaidReference] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows([emptyRow()])
    setRowErrors({})
    setPreview(null)
    setReason("")
    setPaidNow(false)
    setPaidReference("")
    Promise.all([
      fetch("/api/landed-cost-types").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/suppliers").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/landed-cost-templates?active=true").then((r) => (r.ok ? r.json() : [])),
    ]).then(([t, s, tpl]) => {
      setTypes(t)
      setSuppliers(s)
      setTemplates(tpl)
      setTemplateId(startWithTemplates ? tpl[0]?.id ?? "" : "")
    })
  }, [open, startWithTemplates])

  const serviceProvidersFirst = useMemo(
    () => [...suppliers].sort((a, b) => Number(b.type === "SERVICE_PROVIDER") - Number(a.type === "SERVICE_PROVIDER")),
    [suppliers]
  )
  const filled = rows.filter((r) => !isBlank(r))
  const filledIndex = (r: Row) => filled.indexOf(r)

  const update = (key: number, patch: Partial<Row>) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setRowErrors({})
  }
  const addRow = () => {
    const last = rows[rows.length - 1]
    setRows([...rows, emptyRow(last?.paidToSupplierId ?? "", last && { reference: last.reference, costDate: last.costDate })])
  }

  // Template: fills the rows (nothing is saved until "Save all").
  const fillFromTemplate = () => {
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    const first = rows[0]
    const fromTemplate: Row[] = tpl.items.map((i: any) => ({
      ...emptyRow(i.paidToSupplierId ?? poSupplierId, first && { reference: first.reference, costDate: first.costDate }),
      typeId: i.typeId,
      amountType: i.amountType,
      value: String(Number(i.value)),
      percentBase: i.percentBase,
      allocationMethod: i.allocationMethod,
      notes: `Template: ${tpl.name}`,
    }))
    setRows([...rows.filter((r) => !isBlank(r)), ...fromTemplate])
    setTemplateId("")
    setRowErrors({})
  }

  // Live preview of all filled rows together (server: same code as saving).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!open) return
    if (timer.current) clearTimeout(timer.current)
    const ready = filled.filter((r) => r.typeId && r.paidToSupplierId && r.value)
    if (ready.length === 0) {
      setPreview(null)
      return
    }
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/purchase-orders/${purchaseOrderId}/landed-costs/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: filled.map(toBody) }),
      })
      if (res.ok) setPreview(await res.json())
    }, 400)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, purchaseOrderId])

  // Problems from the preview, keyed by row key.
  const previewProblems = useMemo(() => {
    const map: Record<number, string> = {}
    for (const p of preview?.problems ?? []) {
      const row = filled[p.row]
      if (row && row.typeId && row.paidToSupplierId && row.value) map[row.key] = p.message
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])
  const errorOf = (r: Row) => rowErrors[r.key] ?? previewProblems[r.key]
  const incomplete = filled.some((r) => !r.typeId || !r.paidToSupplierId || !r.value)
  const methodProblem = paidNow ? paymentMethodProblems(paidMethod, paymentConfig).error : null

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/purchase-orders/${purchaseOrderId}/landed-costs/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: filled.map(toBody),
          reason: reason || undefined,
          paidNow: paidNow ? { ...paymentMethodBody(paidMethod), reference: paidReference || undefined } : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(data.rowErrors)) {
          setRowErrors(Object.fromEntries(data.rowErrors.map((e: any) => [filled[e.row]?.key, e.message])))
        }
        throw new Error(data.error || "Failed to save the costs")
      }
      onSaved(data)
      onOpenChange(false)
      toast({ title: `${data.createdIds.length} cost line(s) added`, description: "Allocation and product costs were recalculated once." })
      for (const warning of data.warnings ?? []) toast({ title: "Please check", description: warning })
    } catch (e) {
      toast({ title: "Nothing was saved", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add costs</DialogTitle>
          <DialogDescription>
            Enter every cost of this order at once. All rows are saved together or not at all; the product costs are
            recalculated once.
          </DialogDescription>
        </DialogHeader>

        {templates.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/50 p-3">
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label>Fill from a template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Choose a template (e.g. QAADE)" /></SelectTrigger>
                <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button variant="outline" disabled={!templateId} onClick={fillFromTemplate}>Apply template</Button>
            <p className="w-full text-xs text-muted-foreground">Adds the template lines as rows below; check and change them before saving.</p>
          </div>
        )}

        <div className="space-y-3">
          {rows.map((r, index) => {
            const amount = filledIndex(r) >= 0 ? preview?.rows?.[filledIndex(r)]?.amount : null
            const error = errorOf(r)
            return (
              <div key={r.key} className={`rounded-lg border p-3 ${error ? "border-destructive" : ""}`}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">Row {index + 1}</span>
                  <span className="flex items-center gap-3">
                    {amount !== null && amount !== undefined && <span>Amount <b>{formatCurrency(amount)}</b></span>}
                    <Button variant="ghost" size="icon" title="Remove row" disabled={rows.length === 1} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="space-y-1">
                    <Label className="text-xs">Type *</Label>
                    <Select value={r.typeId} onValueChange={(typeId) => update(r.key, { typeId })}>
                      <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                      <SelectContent>{types.filter((t) => t.isActive).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Paid to *</Label>
                    <Select value={r.paidToSupplierId} onValueChange={(paidToSupplierId) => update(r.key, { paidToSupplierId })}>
                      <SelectTrigger><SelectValue placeholder="Party" /></SelectTrigger>
                      <SelectContent>
                        {serviceProvidersFirst.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}{s.type === "SERVICE_PROVIDER" ? " (service provider)" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount *</Label>
                    <div className="flex gap-1">
                      <Select value={r.amountType} onValueChange={(v) => update(r.key, { amountType: v as Row["amountType"] })}>
                        <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FIXED">$</SelectItem>
                          <SelectItem value="PERCENT">%</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input type="number" min="0" step="0.01" value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">% of</Label>
                    <Select value={r.percentBase} disabled={r.amountType !== "PERCENT"} onValueChange={(v) => update(r.key, { percentBase: v as Row["percentBase"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GOODS">Goods value</SelectItem>
                        <SelectItem value="GOODS_PLUS_FIXED">Goods + fixed costs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Allocation</Label>
                    <Select value={r.allocationMethod} onValueChange={(allocationMethod) => update(r.key, { allocationMethod })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(ALLOCATIONS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={r.costDate} onChange={(e) => update(r.key, { costDate: e.target.value })} />
                  </div>
                  <div className="space-y-1 lg:col-span-2">
                    <Label className="text-xs">Reference / invoice no.</Label>
                    <Input value={r.reference} maxLength={100} onChange={(e) => update(r.key, { reference: e.target.value })} />
                  </div>
                  <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                    <Label className="text-xs">Notes</Label>
                    <Input value={r.notes} maxLength={500} onChange={(e) => update(r.key, { notes: e.target.value })} />
                  </div>
                </div>
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              </div>
            )
          })}
          <Button variant="outline" size="sm" onClick={addRow} disabled={rows.length >= 30}>
            <Plus className="mr-2 h-4 w-4" /> Add row
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-medium">Preview (all rows)</span>
            {preview && !preview.error && (
              <span>
                New costs <b>{formatCurrency(preview.newCosts)}</b> · All costs {formatCurrency(preview.totalCosts)} · Uplift{" "}
                <b>{Number(preview.upliftPercent).toFixed(2)}%</b> of goods {formatCurrency(preview.goodsValue)}
              </span>
            )}
          </div>
          {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
          {preview?.items && (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    {filled.map((r) => (
                      <TableHead key={r.key} className="whitespace-nowrap text-right">
                        R{rows.indexOf(r) + 1} {types.find((t) => t.id === r.typeId)?.name ?? ""}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">New costs</TableHead>
                    {seesCost && <TableHead className="text-right">Landed unit</TableHead>}
                    {seesCost && <TableHead className="text-right">Increase</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.product}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                      {filled.map((r, i) => (
                        <TableCell key={r.key} className="text-right">
                          {item.rowAllocations?.[i] !== null && item.rowAllocations?.[i] !== undefined ? formatCurrency(item.rowAllocations[i]) : "-"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium">{formatCurrency(item.newAllocation)}</TableCell>
                      {seesCost && <TableCell className="text-right">{unit4(item.landedUnitCost)}</TableCell>}
                      {seesCost && <TableCell className="text-right">{Number(item.costIncreasePercent).toFixed(2)}%</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {finalized && (
          <div className="space-y-1">
            <Label>Reason for changing finalized costs *</Label>
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {canPay && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={paidNow} onCheckedChange={(c) => setPaidNow(c === true)} />
              Paid now (one supplier payment per paid-to party for all these rows)
            </label>
            {paidNow && (
              <div className="space-y-3">
                <PaymentMethodFields value={paidMethod} onChange={setPaidMethod} idPrefix="bulk-paid" />
                <div className="max-w-sm space-y-1">
                  <Label>Payment reference</Label>
                  <Input value={paidReference} maxLength={100} onChange={(e) => setPaidReference(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || filled.length === 0 || incomplete || Object.keys(previewProblems).length > 0 || !!preview?.error || !!methodProblem || (finalized && !reason.trim())}
          >
            {saving ? "Saving..." : `Save ${filled.length} cost${filled.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

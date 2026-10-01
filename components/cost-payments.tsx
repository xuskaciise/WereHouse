"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  PaymentMethodFields,
  emptyPaymentMethod,
  paymentMethodBody,
  paymentMethodProblems,
  usePaymentConfig,
  type PaymentMethodValue,
} from "@/components/payment-method-fields"

// Paying cost lines (landed costs of purchase orders, stock transfer costs):
// pick open lines, one payment per paid-to party, the server splits the
// amount oldest first (FIFO) and refuses more than the open balance.
// Server: lib/cost-payments.ts, /api/landed-costs, /api/supplier-payments/{bulk,allocation-preview}.

export interface CostLine {
  kind: "LANDED_COST" | "TRANSFER_COST"
  id: string
  supplierId: string
  supplierName: string
  documentId: string
  documentNumber: string
  typeName: string
  reference: string | null
  costDate: string
  amount: number
  paidAmount: number
  openAmount: number
  paymentStatus: string
}

export const lineKey = (l: { kind: string; id: string }) => `${l.kind}:${l.id}`
export const lineRef = (l: { kind: string; id: string }) => (l.kind === "TRANSFER_COST" ? { stockTransferCostId: l.id } : { landedCostId: l.id })
const sum = (values: number[]) => Math.round(values.reduce((s, v) => s + Number(v), 0) * 100) / 100

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = { PAID: "success", PARTLY_PAID: "warning", UNPAID: "secondary" }

/** Open cost lines with checkboxes and "Select all" (FIFO order, oldest first). */
export function CostLinesPicker({
  lines,
  selected,
  onChange,
  allocated,
}: {
  lines: CostLine[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  /** FIFO preview: amount per line key. */
  allocated?: Map<string, number | null>
}) {
  const all = lines.length > 0 && lines.every((l) => selected.has(lineKey(l)))
  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(key)
    else next.delete(key)
    onChange(next)
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all"
                checked={all}
                onCheckedChange={(c) => onChange(c === true ? new Set(lines.map(lineKey)) : new Set())}
              />
            </TableHead>
            <TableHead>Document</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Open</TableHead>
            {allocated && <TableHead className="text-right">This payment</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const key = lineKey(l)
            const part = allocated?.get(key)
            return (
              <TableRow key={key}>
                <TableCell>
                  <Checkbox aria-label={`Pay ${l.typeName} ${l.documentNumber}`} checked={selected.has(key)} onCheckedChange={(c) => toggle(key, c === true)} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {l.documentNumber}
                  <div className="text-xs text-muted-foreground">{l.kind === "TRANSFER_COST" ? "Transfer" : "Purchase order"}</div>
                </TableCell>
                <TableCell>
                  {l.typeName}
                  {l.reference && <div className="text-xs text-muted-foreground">{l.reference}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(l.costDate)}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(l.amount)}
                  {l.paymentStatus !== "UNPAID" && (
                    <div><Badge variant={STATUS_VARIANT[l.paymentStatus]}>{l.paymentStatus.replace("_", " ")}</Badge></div>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(l.openAmount)}</TableCell>
                {allocated && (
                  <TableCell className="text-right">
                    {!selected.has(key) ? "-" : part === undefined ? "…" : part === null ? formatCurrency(0) : formatCurrency(part)}
                    {selected.has(key) && part !== undefined && part !== null && part < l.openAmount && (
                      <div className="text-xs text-muted-foreground">{formatCurrency(l.openAmount - part)} stays open</div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Server FIFO preview of `amount` over the selected lines (same code as saving).
 * Returns the amount per line key, or the error to show (e.g. more than open).
 */
export function useFifoPreview(supplierId: string, lines: CostLine[], selected: Set<string>, amount: string) {
  const [result, setResult] = useState<{ allocated: Map<string, number | null>; error: string | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const picked = useMemo(() => lines.filter((l) => selected.has(lineKey(l))), [lines, selected])
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!supplierId || picked.length === 0) {
      setResult(null)
      return
    }
    timer.current = setTimeout(async () => {
      const res = await fetch("/api/supplier-payments/allocation-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, lines: picked.map(lineRef), amount: amount || undefined }),
      })
      const data = await res.json().catch(() => ({ error: "Preview failed" }))
      if (!res.ok || data.error) {
        setResult({ allocated: new Map(), error: data.error || "Preview failed" })
        return
      }
      setResult({ allocated: new Map(data.lines.map((l: any) => [lineKey(l), l.allocated])), error: null })
    }, 300)
  }, [supplierId, picked, amount])
  return result
}

/** "Pay costs" on a purchase order: open lines grouped by paid-to party, one payment per party. */
export function PayCostsDialog({
  purchaseOrderId,
  open,
  onOpenChange,
  onPaid,
}: {
  purchaseOrderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPaid: () => void
}) {
  const { toast } = useToast()
  const config = usePaymentConfig()
  const [lines, setLines] = useState<CostLine[] | null>(null)
  const [groups, setGroups] = useState<Record<string, PartyPayment>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLines(null)
    fetch(`/api/landed-costs?purchaseOrderId=${purchaseOrderId}&open=1`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CostLine[]) => {
        setLines(data)
        const next: Record<string, PartyPayment> = {}
        for (const l of data) {
          next[l.supplierId] ??= { include: true, selected: new Set(), amount: "", amountEdited: false, method: emptyPaymentMethod(), date: new Date().toISOString().slice(0, 10), reference: "" }
          next[l.supplierId].selected.add(lineKey(l))
        }
        setGroups(next)
      })
  }, [open, purchaseOrderId])

  const parties = useMemo(() => {
    const map = new Map<string, { name: string; lines: CostLine[] }>()
    for (const l of lines ?? []) {
      if (!map.has(l.supplierId)) map.set(l.supplierId, { name: l.supplierName, lines: [] })
      map.get(l.supplierId)!.lines.push(l)
    }
    return [...map.entries()]
  }, [lines])

  const included = parties.filter(([id]) => groups[id]?.include && groups[id].selected.size > 0)
  const problems = included.map(([id]) => paymentMethodProblems(groups[id].method, config).error).filter(Boolean)

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/supplier-payments/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payments: included.map(([supplierId, party]) => {
            const g = groups[supplierId]
            return {
              supplierId,
              lines: party.lines.filter((l) => g.selected.has(lineKey(l))).map(lineRef),
              amount: g.amount || undefined,
              ...paymentMethodBody(g.method),
              paymentDate: g.date,
              reference: g.reference || undefined,
            }
          }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Payment failed")
      toast({ title: "Costs paid", description: `${data.payments.length} payment(s) recorded` })
      for (const w of data.warnings ?? []) toast({ title: "Please check", description: w })
      onOpenChange(false)
      onPaid()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pay costs</DialogTitle>
          <DialogDescription>
            One payment per paid-to party. A smaller amount pays the oldest lines first; more than the open balance is not accepted.
          </DialogDescription>
        </DialogHeader>
        {lines === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : parties.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every cost of this order is paid.</p>
        ) : (
          <div className="space-y-6">
            {parties.map(([supplierId, party]) => (
              <PartyPaymentCard
                key={supplierId}
                supplierId={supplierId}
                name={party.name}
                lines={party.lines}
                value={groups[supplierId]}
                onChange={(g) => setGroups((all) => ({ ...all, [supplierId]: g }))}
              />
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving || included.length === 0 || problems.length > 0} onClick={save}>
            {saving ? "Saving..." : `Pay ${included.length} part${included.length === 1 ? "y" : "ies"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PartyPayment {
  include: boolean
  selected: Set<string>
  amount: string
  amountEdited: boolean
  method: PaymentMethodValue
  date: string
  reference: string
}

function PartyPaymentCard({
  supplierId,
  name,
  lines,
  value,
  onChange,
}: {
  supplierId: string
  name: string
  lines: CostLine[]
  value: PartyPayment | undefined
  onChange: (v: PartyPayment) => void
}) {
  const selectedOpen = sum(lines.filter((l) => value?.selected.has(lineKey(l))).map((l) => l.openAmount))
  const preview = useFifoPreview(value?.include ? supplierId : "", lines, value?.selected ?? new Set(), value?.amountEdited ? value.amount : "")
  if (!value) return null
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-medium">
          <Checkbox checked={value.include} onCheckedChange={(c) => onChange({ ...value, include: c === true })} />
          {name}
        </label>
        <span className="text-sm text-muted-foreground">
          Open on selected lines: <b>{formatCurrency(selectedOpen)}</b>
        </span>
      </div>
      {value.include && (
        <>
          <CostLinesPicker
            lines={lines}
            selected={value.selected}
            onChange={(selected) => onChange({ ...value, selected })}
            allocated={preview?.allocated}
          />
          {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={selectedOpen.toFixed(2)}
                value={value.amountEdited ? value.amount : selectedOpen.toFixed(2)}
                onChange={(e) => onChange({ ...value, amount: e.target.value, amountEdited: true })}
              />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Reference</Label>
              <Input value={value.reference} maxLength={100} onChange={(e) => onChange({ ...value, reference: e.target.value })} />
            </div>
          </div>
          <PaymentMethodFields value={value.method} onChange={(method) => onChange({ ...value, method })} idPrefix={`pay-${supplierId}`} />
        </>
      )}
    </div>
  )
}

/** Cost lines a supplier payment settled (payment details / receipt). */
export function PaymentCostLines({ allocations }: { allocations: any[] }) {
  if (!allocations?.length) return null
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-muted-foreground">Cost lines paid</div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead className="text-right">Line amount</TableHead>
              <TableHead className="text-right">Paid here</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.map((a) => {
              const c = a.landedCost ?? a.stockTransferCost
              return (
                <TableRow key={a.id}>
                  <TableCell>{a.landedCost?.purchaseOrder?.orderNumber ?? a.stockTransferCost?.stockTransfer?.transferNumber}</TableCell>
                  <TableCell>
                    {c?.type?.name}
                    {c?.reference && <div className="text-xs text-muted-foreground">{c.reference}</div>}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(c?.amount)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(a.amount)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

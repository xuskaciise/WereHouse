"use client"

import { useCallback, useEffect, useState } from "react"
import { Pencil, Plus, Power, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"
import { formatCurrency } from "@/lib/utils"
import { useConfirm } from "@/components/confirm-provider"

interface Line {
  typeId: string
  paidToSupplierId: string
  amountType: "FIXED" | "PERCENT"
  value: string
  percentBase: "GOODS" | "GOODS_PLUS_FIXED"
  allocationMethod: "VALUE" | "QUANTITY" | "WEIGHT" | "VOLUME"
}
const emptyLine = (): Line => ({ typeId: "", paidToSupplierId: "", amountType: "FIXED", value: "", percentBase: "GOODS", allocationMethod: "VALUE" })
const PO_SUPPLIER = "__po"
const ALLOCATION: Record<string, string> = { VALUE: "By value", QUANTITY: "By quantity", WEIGHT: "By weight", VOLUME: "By volume" }

const describe = (i: any) =>
  `${i.type?.name}: ${i.amountType === "PERCENT" ? `${Number(i.value)}% of ${i.percentBase === "GOODS" ? "goods" : "goods + fixed costs"}` : formatCurrency(i.value)} · ${ALLOCATION[i.allocationMethod]} · ${i.paidToSupplier?.name ?? "PO supplier / chosen when applied"}`

// Saved sets of landed costs (e.g. customs + clearing + transport of one
// route), applied to a purchase order in one click from its landed costs.
export function LandedCostTemplatesCard() {
  const { toast } = useToast()
  const canCreate = useCan("landed_cost_types", "create")
  const canEdit = useCan("landed_cost_types", "edit")
  const canDelete = useCan("landed_cost_types", "delete")
  const confirm = useConfirm()
  const [templates, setTemplates] = useState<any[]>([])
  const [types, setTypes] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [form, setForm] = useState<{ id?: string; name: string; description: string; items: Line[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/landed-cost-templates")
    if (res.ok) setTemplates(await res.json())
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const openForm = async (t?: any) => {
    if (!types.length) {
      const r = await fetch("/api/landed-cost-types?active=true")
      if (r.ok) setTypes(await r.json())
    }
    if (!suppliers.length) {
      const r = await fetch("/api/suppliers")
      if (r.ok) setSuppliers(await r.json())
    }
    setForm(
      t
        ? {
            id: t.id,
            name: t.name,
            description: t.description ?? "",
            items: t.items.map((i: any) => ({
              typeId: i.typeId,
              paidToSupplierId: i.paidToSupplierId ?? "",
              amountType: i.amountType,
              value: String(Number(i.value)),
              percentBase: i.percentBase,
              allocationMethod: i.allocationMethod,
            })),
          }
        : { name: "", description: "", items: [emptyLine()] }
    )
  }

  const call = async (url: string, method: string, body?: unknown, success?: string) => {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      if (success) toast({ title: success })
      await load()
      return true
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }

  const setLine = (index: number, patch: Partial<Line>) =>
    setForm((f) => f && { ...f, items: f.items.map((l, i) => (i === index ? { ...l, ...patch } : l)) })

  const save = async () => {
    if (!form) return
    const body = {
      name: form.name,
      description: form.description,
      items: form.items.map((l) => ({ ...l, paidToSupplierId: l.paidToSupplierId || null })),
    }
    const ok = form.id
      ? await call(`/api/landed-cost-templates/${form.id}`, "PATCH", body, "Template saved")
      : await call("/api/landed-cost-templates", "POST", body, "Template created")
    if (ok) setForm(null)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Landed cost templates</CardTitle>
            <CardDescription>
              A saved set of costs (e.g. your usual customs, clearing and transport) that is added to a purchase order in one
              click under Landed costs → Apply template. Every line then is a normal cost you can still edit.
            </CardDescription>
          </div>
          {canCreate && <Button onClick={() => openForm()}><Plus className="mr-2 h-4 w-4" /> New template</Button>}
        </div>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No templates yet.{canCreate && " Create one to add recurring costs in one click."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Cost lines</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} className={t.isActive ? "" : "opacity-60"}>
                  <TableCell className="align-top">
                    <div className="font-medium">{t.name}</div>
                    {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                    {!t.isActive && <Badge variant="secondary" className="mt-1">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <ul className="space-y-0.5">{t.items.map((i: any) => <li key={i.id}>{describe(i)}</li>)}</ul>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right align-top">
                    {canEdit && <Button variant="ghost" size="icon" title="Edit" onClick={() => openForm(t)}><Pencil className="h-4 w-4" /></Button>}
                    {canEdit && (
                      <Button variant="ghost" size="icon" title={t.isActive ? "Deactivate" : "Activate"} disabled={busy} onClick={() => call(`/api/landed-cost-templates/${t.id}`, "PATCH", { isActive: !t.isActive }, t.isActive ? "Deactivated" : "Activated")}>
                        <Power className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" title="Delete" disabled={busy} onClick={async () => (await confirm({ title: `Delete template “${t.name}”?`, description: "Costs already applied to purchase orders stay.", confirmLabel: "Delete", destructive: true })) && call(`/api/landed-cost-templates/${t.id}`, "DELETE", undefined, "Template deleted")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={form !== null} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit template" : "New landed cost template"}</DialogTitle>
            <DialogDescription>Leave “Paid to” empty to use the purchase order supplier (or choose one when applying).</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. QAADE" /></div>
                <div className="space-y-1"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              </div>
              <div className="space-y-2">
                {form.items.map((l, i) => (
                  <div key={i} className="grid items-end gap-2 rounded-md border p-2 md:grid-cols-[1.3fr_1.3fr_0.8fr_0.8fr_1fr_1fr_auto]">
                    <div className="space-y-1">
                      <Label className="text-xs">Cost type *</Label>
                      <Select value={l.typeId} onValueChange={(typeId) => setLine(i, { typeId })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Type" /></SelectTrigger>
                        <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Paid to</Label>
                      <Select value={l.paidToSupplierId || PO_SUPPLIER} onValueChange={(v) => setLine(i, { paidToSupplierId: v === PO_SUPPLIER ? "" : v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PO_SUPPLIER}>PO supplier / when applied</SelectItem>
                          {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount</Label>
                      <Select value={l.amountType} onValueChange={(v) => setLine(i, { amountType: v as Line["amountType"] })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="FIXED">Fixed</SelectItem><SelectItem value="PERCENT">%</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{l.amountType === "PERCENT" ? "Percent *" : "Amount *"}</Label>
                      <Input className="h-9" type="number" min="0" step="0.01" value={l.value} onChange={(e) => setLine(i, { value: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">% of</Label>
                      <Select value={l.percentBase} disabled={l.amountType !== "PERCENT"} onValueChange={(v) => setLine(i, { percentBase: v as Line["percentBase"] })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="GOODS">Goods</SelectItem><SelectItem value="GOODS_PLUS_FIXED">Goods + fixed costs</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Allocation</Label>
                      <Select value={l.allocationMethod} onValueChange={(v) => setLine(i, { allocationMethod: v as Line["allocationMethod"] })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(ALLOCATION).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button variant="ghost" size="icon" title="Remove line" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, items: [...form.items, emptyLine()] })}><Plus className="mr-2 h-4 w-4" /> Add line</Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button disabled={busy || !form?.name.trim() || form.items.some((l) => !l.typeId || !l.value)} onClick={save}>Save template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

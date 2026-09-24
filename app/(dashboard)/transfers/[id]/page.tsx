"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useParams, useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, PackageCheck, Pencil, Plus, Printer, Send, Trash2, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCan, useCurrentUser } from "@/components/providers/current-user-provider"
import { formatCurrency, formatDate } from "@/lib/utils"
import { TRANSFER_EVENTS, TRANSFER_STATUS } from "@/lib/transfer-labels"
import { PaymentMethodFields, emptyPaymentMethod, paymentMethodBody, paymentMethodProblems, usePaymentConfig, type PaymentMethodValue } from "@/components/payment-method-fields"

const when = (d: string | null | undefined) => (d ? `${formatDate(d)} ${new Date(d).toLocaleTimeString()}` : "")

export default function TransferDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const currentUser = useCurrentUser()
  const canEdit = useCan("stock_transfers", "edit")
  const canDelete = useCan("stock_transfers", "delete")
  const canPay = useCan("supplier_payments", "create")
  const seesCost = useCan("product_cost", "view")
  const isAdmin = currentUser.role === "ADMIN"

  const [t, setT] = useState<any | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receive, setReceive] = useState<Record<string, { received: string; lost: string; reason: string }>>({})
  const [receiveNotes, setReceiveNotes] = useState("")
  const [closeOpen, setCloseOpen] = useState(false)
  const [close, setClose] = useState<Record<string, { action: string; reason: string }>>({})
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [costDialog, setCostDialog] = useState<{ open: boolean; cost: any | null }>({ open: false, cost: null })
  const [costForm, setCostForm] = useState({ typeId: "", paidToSupplierId: "", amount: "", reference: "", costDate: "", notes: "", reason: "", paidNow: false })
  const [types, setTypes] = useState<any[]>([])
  const paymentConfig = usePaymentConfig()
  const [paidMethod, setPaidMethod] = useState<PaymentMethodValue>(emptyPaymentMethod("BANK_TRANSFER"))
  const [suppliers, setSuppliers] = useState<any[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/stock-transfers/${id}`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) setT(data)
    else setError(data.error || "Failed to load the transfer")
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  const call = async (path: string, method: string, body?: unknown, success?: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/stock-transfers/${id}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      if (success) toast({ title: success })
      for (const warning of data.warnings ?? []) toast({ title: "Please check", description: warning })
      if (method === "DELETE" && path === "") {
        router.push("/transfers")
        return true
      }
      setT(data)
      return true
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="py-12 text-center text-destructive">{error}</p>
  if (!t) return <p className="py-12 text-center text-muted-foreground">Loading...</p>

  const status = TRANSFER_STATUS[t.status]
  const open = t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED"
  const costsEditable = t.status !== "CANCELLED" && (t.status !== "RECEIVED" || isAdmin)

  const openReceive = () => {
    setReceive(Object.fromEntries(t.items.map((i: any) => [i.id, { received: String(i.inTransitQuantity), lost: "0", reason: "" }])))
    setReceiveNotes("")
    setReceiveOpen(true)
  }
  const openClose = () => {
    setClose(Object.fromEntries(t.items.filter((i: any) => i.inTransitQuantity > 0).map((i: any) => [i.id, { action: "RETURN", reason: "" }])))
    setCloseOpen(true)
  }
  const openCost = async (cost: any | null) => {
    if (!types.length) {
      const r = await fetch("/api/landed-cost-types?active=true")
      if (r.ok) setTypes(await r.json())
    }
    if (!suppliers.length) {
      const r = await fetch("/api/suppliers")
      if (r.ok) setSuppliers(await r.json())
    }
    setCostForm({
      typeId: cost?.typeId ?? "",
      paidToSupplierId: cost?.paidToSupplierId ?? "",
      amount: cost ? String(cost.amount) : "",
      reference: cost?.reference ?? "",
      costDate: (cost?.costDate ?? new Date().toISOString()).slice(0, 10),
      notes: cost?.notes ?? "",
      reason: "",
      paidNow: false,
    })
    setPaidMethod(emptyPaymentMethod("BANK_TRANSFER"))
    setCostDialog({ open: true, cost })
  }

  const receiveErrors = t.items.flatMap((i: any) => {
    const r = receive[i.id]
    if (!r) return []
    const received = Number(r.received || 0), lost = Number(r.lost || 0)
    const out: string[] = []
    if (!Number.isInteger(received) || !Number.isInteger(lost) || received < 0 || lost < 0) out.push(`${i.product.name}: whole numbers only`)
    if (received + lost > i.inTransitQuantity) out.push(`${i.product.name}: only ${i.inTransitQuantity} in transit`)
    if (lost > 0 && !r.reason.trim()) out.push(`${i.product.name}: a reason is required for damaged / lost units`)
    return out
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Button asChild variant="ghost">
          <Link href="/transfers"><ArrowLeft className="mr-2 h-4 w-4" /> Stock transfers</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {canEdit && t.status === "DRAFT" && (
            <Button onClick={() => call("/dispatch", "POST", undefined, "Dispatched")} disabled={busy || t.draftWarning}>
              <Send className="mr-2 h-4 w-4" /> Dispatch
            </Button>
          )}
          {canEdit && open && (
            <Button onClick={openReceive} disabled={busy}>
              <PackageCheck className="mr-2 h-4 w-4" /> Receive
            </Button>
          )}
          {canEdit && t.status === "PARTIALLY_RECEIVED" && (
            <Button variant="outline" onClick={openClose} disabled={busy}>
              <Undo2 className="mr-2 h-4 w-4" /> Close remaining
            </Button>
          )}
          {canEdit && (t.status === "DRAFT" || t.status === "IN_TRANSIT") && (
            <Button variant="outline" onClick={() => { setCancelReason(""); setCancelOpen(true) }} disabled={busy}>
              <X className="mr-2 h-4 w-4" /> Cancel transfer
            </Button>
          )}
          {canDelete && t.status === "DRAFT" && t.costs.length === 0 && (
            <Button variant="ghost" onClick={() => call("", "DELETE", undefined, "Draft deleted")} disabled={busy}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete draft
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print delivery note
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">
                {t.transferNumber} <Badge variant={status?.variant} className="ml-2 align-middle">{status?.label}</Badge>
                {t.instant && <Badge variant="outline" className="ml-2 align-middle">Instant</Badge>}
              </CardTitle>
              <CardDescription className="mt-1 text-base">
                {t.fromWarehouse?.name} → {t.toWarehouse?.name}
              </CardDescription>
              <p className="mt-1 text-sm text-muted-foreground">
                Created {formatDate(t.createdAt)} by {t.user?.username}
                {t.expectedDate && ` · expected ${formatDate(t.expectedDate)}`}
              </p>
              {t.notes && <p className="mt-1 text-sm">{t.notes}</p>}
              {t.cancelReason && <p className="mt-1 text-sm text-destructive">Cancelled: {t.cancelReason}</p>}
            </div>
            <Image src="/siu_logo.png" alt="SIU" width={64} height={64} className="h-14 w-auto" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {t.draftWarning && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm print:hidden">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
              Not enough available stock in {t.fromWarehouse?.name} for some lines right now. The draft is kept, but it
              can only be dispatched when the stock is available.
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  {t.status === "DRAFT" && <TableHead className="text-right">Available</TableHead>}
                  <TableHead className="text-right">Dispatched</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Damaged / lost</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">In transit</TableHead>
                  {seesCost && <TableHead className="text-right">Unit cost</TableHead>}
                  {seesCost && <TableHead className="text-right">Transfer cost</TableHead>}
                  <TableHead className="hidden text-right print:table-cell">Signature</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.items.map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div className="font-medium">{i.product?.name}</div>
                      <div className="text-xs text-muted-foreground">{i.product?.sku}</div>
                    </TableCell>
                    <TableCell className="text-right">{i.quantity}</TableCell>
                    {t.status === "DRAFT" && (
                      <TableCell className={`text-right ${i.insufficient ? "font-medium text-destructive" : ""}`}>{i.available}</TableCell>
                    )}
                    <TableCell className="text-right">{i.dispatchedQuantity}</TableCell>
                    <TableCell className="text-right">{i.receivedQuantity}</TableCell>
                    <TableCell className="text-right">{i.lostQuantity || "-"}</TableCell>
                    <TableCell className="text-right">{i.returnedQuantity || "-"}</TableCell>
                    <TableCell className="text-right font-medium">{i.inTransitQuantity || "-"}</TableCell>
                    {seesCost && <TableCell className="text-right">${Number(i.unitCost || 0).toFixed(4)}</TableCell>}
                    {seesCost && <TableCell className="text-right">{formatCurrency(i.allocatedCost || 0)}</TableCell>}
                    <TableCell className="hidden print:table-cell" />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="hidden grid-cols-2 gap-8 pt-8 text-sm print:grid">
            <div className="border-t pt-2">Dispatched by (name / signature / date)</div>
            <div className="border-t pt-2">Received by (name / signature / date)</div>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transfer costs</CardTitle>
              <CardDescription>
                E.g. transport between the warehouses. Allocated by value and added to the destination cost; a payable to the
                paid-to party. {t.status === "RECEIVED" && "Completed transfer: only an admin can change costs (with a reason)."}
              </CardDescription>
            </div>
            {canEdit && costsEditable && (
              <Button size="sm" onClick={() => openCost(null)}>
                <Plus className="mr-2 h-4 w-4" /> Add cost
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {t.costs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transfer costs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Paid to</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.costs.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.type?.name}</TableCell>
                    <TableCell>{c.paidToSupplier?.name}</TableCell>
                    <TableCell>{c.reference || "-"}</TableCell>
                    <TableCell><Badge variant={c.paymentStatus === "PAID" ? "success" : c.paymentStatus === "PARTLY_PAID" ? "warning" : "secondary"}>{c.paymentStatus.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right">{formatCurrency(c.amount)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {canEdit && costsEditable && (
                        <>
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => openCost(c)}><Pencil className="h-4 w-4" /></Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => {
                              const reason = t.status === "RECEIVED" ? window.prompt("Reason for deleting this cost") : undefined
                              if (t.status === "RECEIVED" && !reason) return
                              call(`/costs/${c.id}`, "DELETE", { reason }, "Cost deleted")
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 border-l pl-4">
            {t.events.map((e: any) => (
              <li key={e.id} className="text-sm">
                <div className="font-medium">{TRANSFER_EVENTS[e.type] ?? e.type}</div>
                <div className="text-muted-foreground">
                  {when(e.createdAt)} · {e.user?.username}
                  {e.data?.received !== undefined && ` · received ${e.data.received}`}
                  {e.data?.lost ? ` · damaged/lost ${e.data.lost}` : ""}
                  {e.data?.after?.amount && ` · ${e.data.after.type} $${e.data.after.amount}`}
                  {e.data?.before?.amount && !e.data?.after && ` · ${e.data.before.type} $${e.data.before.amount}`}
                </div>
                {e.notes && <div>{e.notes}</div>}
                {e.data?.reasons?.length > 0 && <div className="text-muted-foreground">Reason: {e.data.reasons.join("; ")}</div>}
                {e.data?.lines?.map((l: any) => (
                  <div key={l.itemId} className="text-muted-foreground">
                    {l.action === "RETURN" ? "Returned to source" : "Written off"}: {l.reason}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receive at {t.toWarehouse?.name}</DialogTitle>
            <DialogDescription>
              Enter what arrived. Damaged or missing units need a reason and are booked as a loss. Anything left can be received
              later or closed.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">In transit</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Damaged / lost</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.items.filter((i: any) => i.inTransitQuantity > 0).map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell>{i.product?.name}</TableCell>
                  <TableCell className="text-right">{i.inTransitQuantity}</TableCell>
                  <TableCell className="text-right">
                    <Input type="number" min="0" className="ml-auto h-8 w-20 text-right" value={receive[i.id]?.received ?? ""} onChange={(e) => setReceive({ ...receive, [i.id]: { ...receive[i.id], received: e.target.value } })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input type="number" min="0" className="ml-auto h-8 w-20 text-right" value={receive[i.id]?.lost ?? ""} onChange={(e) => setReceive({ ...receive, [i.id]: { ...receive[i.id], lost: e.target.value } })} />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8" placeholder="Required if damaged / lost" value={receive[i.id]?.reason ?? ""} onChange={(e) => setReceive({ ...receive, [i.id]: { ...receive[i.id], reason: e.target.value } })} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Input placeholder="Notes (optional)" value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} />
          {receiveErrors.length > 0 && <ul className="text-sm text-destructive">{receiveErrors.map((m: string) => <li key={m}>{m}</li>)}</ul>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || receiveErrors.length > 0}
              onClick={async () => {
                const lines = Object.entries(receive).map(([itemId, r]) => ({ itemId, received: Number(r.received || 0), lost: Number(r.lost || 0), reason: r.reason }))
                if (await call("/receive", "POST", { lines, notes: receiveNotes }, "Received")) setReceiveOpen(false)
              }}
            >
              Confirm receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Close remaining quantity</DialogTitle>
            <DialogDescription>For each line still in transit: return it to {t.fromWarehouse?.name} (at its dispatch cost) or write it off as a loss. A reason is required.</DialogDescription>
          </DialogHeader>
          {t.items.filter((i: any) => i.inTransitQuantity > 0).map((i: any) => (
            <div key={i.id} className="grid items-center gap-2 sm:grid-cols-[1fr_180px_1fr]">
              <div className="text-sm">{i.product?.name} <span className="text-muted-foreground">({i.inTransitQuantity} in transit)</span></div>
              <Select value={close[i.id]?.action ?? "RETURN"} onValueChange={(action) => setClose({ ...close, [i.id]: { ...close[i.id], action } })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RETURN">Return to source</SelectItem>
                  <SelectItem value="WRITE_OFF">Write off as loss</SelectItem>
                </SelectContent>
              </Select>
              <Input className="h-8" placeholder="Reason (required)" value={close[i.id]?.reason ?? ""} onChange={(e) => setClose({ ...close, [i.id]: { ...close[i.id], reason: e.target.value } })} />
            </div>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || Object.values(close).some((c) => !c.reason.trim())}
              onClick={async () => {
                const lines = Object.entries(close).map(([itemId, c]) => ({ itemId, action: c.action, reason: c.reason }))
                if (await call("/close", "POST", { lines }, "Closed")) setCloseOpen(false)
              }}
            >
              Close lines
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {t.transferNumber}</DialogTitle>
            <DialogDescription>
              {t.status === "IN_TRANSIT" ? `All goods in transit return to ${t.fromWarehouse?.name} at their dispatch cost.` : "The draft is cancelled; no stock changes."}
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Reason (required)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={busy || !cancelReason.trim()} onClick={async () => { if (await call("/cancel", "POST", { reason: cancelReason }, "Transfer cancelled")) setCancelOpen(false) }}>
              Cancel transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={costDialog.open} onOpenChange={(o) => setCostDialog((d) => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{costDialog.cost ? "Edit transfer cost" : "Add transfer cost"}</DialogTitle>
            <DialogDescription>Fixed amount, allocated to the lines by value.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select value={costForm.typeId} onValueChange={(typeId) => setCostForm({ ...costForm, typeId })}>
                <SelectTrigger><SelectValue placeholder="Cost type" /></SelectTrigger>
                <SelectContent>{types.map((ty) => <SelectItem key={ty.id} value={ty.id}>{ty.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Paid to *</Label>
              <Select value={costForm.paidToSupplierId} onValueChange={(paidToSupplierId) => setCostForm({ ...costForm, paidToSupplierId })}>
                <SelectTrigger><SelectValue placeholder="Service provider" /></SelectTrigger>
                <SelectContent>
                  {[...suppliers].sort((a, b) => Number(b.type === "SERVICE_PROVIDER") - Number(a.type === "SERVICE_PROVIDER")).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.type === "SERVICE_PROVIDER" ? " (service provider)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Amount *</Label><Input type="number" min="0" step="0.01" value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })} /></div>
              <div className="space-y-1"><Label>Date</Label><Input type="date" value={costForm.costDate} onChange={(e) => setCostForm({ ...costForm, costDate: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label>Reference / invoice no.</Label><Input value={costForm.reference} onChange={(e) => setCostForm({ ...costForm, reference: e.target.value })} /></div>
            <div className="space-y-1"><Label>Notes</Label><Input value={costForm.notes} onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })} /></div>
            {t.status === "RECEIVED" && (
              <div className="space-y-1"><Label>Reason (completed transfer) *</Label><Input value={costForm.reason} onChange={(e) => setCostForm({ ...costForm, reason: e.target.value })} /></div>
            )}
            {!costDialog.cost && canPay && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={costForm.paidNow} onCheckedChange={(c) => setCostForm({ ...costForm, paidNow: c === true })} />
                Paid now (records a supplier payment)
              </label>
            )}
            {!costDialog.cost && canPay && costForm.paidNow && (
              <PaymentMethodFields value={paidMethod} onChange={setPaidMethod} idPrefix="transfer-paid" />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCostDialog({ open: false, cost: null })}>Cancel</Button>
            <Button
              disabled={
                busy || !costForm.typeId || !costForm.paidToSupplierId || !costForm.amount ||
                (!costDialog.cost && costForm.paidNow && !!paymentMethodProblems(paidMethod, paymentConfig).error)
              }
              onClick={async () => {
                const body = {
                  ...costForm,
                  reason: costForm.reason || undefined,
                  paidNow: !costDialog.cost && costForm.paidNow ? paymentMethodBody(paidMethod) : undefined,
                }
                const ok = costDialog.cost
                  ? await call(`/costs/${costDialog.cost.id}`, "PATCH", body, "Cost updated")
                  : await call("/costs", "POST", body, "Cost added")
                if (ok) setCostDialog({ open: false, cost: null })
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

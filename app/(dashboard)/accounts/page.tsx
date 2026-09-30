"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, BookOpen, CheckCircle2, Pencil, Plus, RefreshCw, Scale, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCan, useCurrentUser } from "@/components/providers/current-user-provider"
import { formatCurrency } from "@/lib/utils"
import { ACCOUNT_TYPES, GROUPS_OF, GROUP_LABEL, TYPE_LABEL } from "@/lib/account-labels"

const empty = { id: "", code: "", name: "", type: "EXPENSE", group: "OPERATING_EXPENSE", description: "", isActive: true, systemKey: null as string | null }

// Chart of accounts with balances; journal health and backfill for admins.
export default function AccountsPage() {
  const { toast } = useToast()
  const canEdit = useCan("accounting", "edit")
  const isAdmin = useCurrentUser().role === "ADMIN"
  const [accounts, setAccounts] = useState<any[]>([])
  const [health, setHealth] = useState<any | null>(null)
  const [form, setForm] = useState<typeof empty | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [a, h] = await Promise.all([fetch("/api/accounts"), fetch("/api/accounts/sync")])
    if (a.ok) setAccounts(await a.json())
    if (h.ok) setHealth(await h.json())
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const body = { code: form.code, name: form.name, type: form.type, group: form.group, description: form.description, isActive: form.isActive }
      const res = await fetch(form.id ? `/api/accounts/${form.id}` : "/api/accounts", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      toast({ title: form.id ? "Account updated" : "Account created" })
      setForm(null)
      load()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: any) => {
    if (!window.confirm(`Delete account ${a.code} ${a.name}?`)) return
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast({ title: "Error", description: data.error || "Failed", variant: "destructive" })
    toast({ title: "Account deleted" })
    load()
  }

  const sync = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/accounts/sync", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      toast({
        title: "Journals synchronised",
        description: `${data.documents} document(s) checked, ${data.posted} entr${data.posted === 1 ? "y" : "ies"} posted${data.openingBalance ? ", opening stock balance booked" : ""}.`,
      })
      load()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const inventoryOff = (health?.inventory ?? []).filter((r: any) => Math.abs(Number(r.difference)) > 0.05)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chart of accounts</h1>
          <p className="text-muted-foreground">Double-entry journals are posted automatically from purchases, sales, returns, payments, expenses and stock movements</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/accounts/journal"><BookOpen className="mr-2 h-4 w-4" /> Journal</Link></Button>
          <Button asChild variant="outline"><Link href="/accounts/trial-balance"><Scale className="mr-2 h-4 w-4" /> Trial balance</Link></Button>
          {canEdit && <Button onClick={() => setForm({ ...empty })}><Plus className="mr-2 h-4 w-4" /> New account</Button>}
        </div>
      </div>

      {health && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6 text-sm">
            <div className="space-y-1">
              {health.missing === 0 ? (
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /> Every document has its journal entry.</div>
              ) : (
                <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-yellow-600" /> {health.missing} document(s) without a journal entry (older data).</div>
              )}
              {inventoryOff.length === 0 ? (
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /> Inventory accounts match the stock value.</div>
              ) : (
                inventoryOff.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" /> {r.code} {r.name}: ledger {formatCurrency(r.ledger)}, stock {formatCurrency(r.actual)}
                  </div>
                ))
              )}
            </div>
            {isAdmin && (
              <Button variant="outline" disabled={busy} onClick={sync}>
                <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sync / backfill journals
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {ACCOUNT_TYPES.map((type) => {
        const rows = accounts.filter((a) => a.type === type)
        if (rows.length === 0) return null
        return (
          <Card key={type}>
            <CardHeader className="pb-2">
              <CardTitle>{TYPE_LABEL[type]}s</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.id} className={a.isActive ? "" : "opacity-50"}>
                      <TableCell className="font-mono">{a.code}</TableCell>
                      <TableCell>
                        <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
                        {a.systemKey && <Badge variant="outline" className="ml-2">system</Badge>}
                        {!a.isActive && <Badge variant="secondary" className="ml-2">inactive</Badge>}
                        {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                      </TableCell>
                      <TableCell>{GROUP_LABEL[a.group]}</TableCell>
                      <TableCell className="text-right">{formatCurrency(a.debit)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(a.credit)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(a.balance)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {canEdit && (
                          <>
                            <Button variant="ghost" size="icon" title="Edit" onClick={() => setForm({ ...empty, ...a, description: a.description ?? "" })}><Pencil className="h-4 w-4" /></Button>
                            {!a.systemKey && Number(a.debit) === 0 && Number(a.credit) === 0 && (
                              <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(a)}><Trash2 className="h-4 w-4" /></Button>
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}

      <Dialog open={form !== null} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit account" : "New account"}</DialogTitle>
            <DialogDescription>
              {form?.systemKey ? "System account: used by the automatic journals, so its type stays fixed." : "Accounts of the Sales, COGS and Inventory groups can be linked to categories and products."}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. 4010" /></div>
                <div className="col-span-2 space-y-1"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={form.type} disabled={!!form.systemKey} onValueChange={(type) => setForm({ ...form, type, group: GROUPS_OF[type][0] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Group</Label>
                  <Select value={form.group} disabled={!!form.systemKey} onValueChange={(group) => setForm({ ...form, group })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{GROUPS_OF[form.type].map((g) => <SelectItem key={g} value={g}>{GROUP_LABEL[g]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              {form.id && !form.systemKey && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button disabled={busy || !form?.code || !form?.name} onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

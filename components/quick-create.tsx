"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"

// "+ New" next to a customer / supplier / product picker: creates the record
// without leaving the form (same API and validation as the full pages).

type Kind = "customer" | "supplier" | "product"
const MODULE = { customer: "customers", supplier: "suppliers", product: "products" } as const
const TITLE = { customer: "New customer", supplier: "New supplier", product: "New product" }

export function QuickCreateButton({ kind, onCreated, initialName = "" }: { kind: Kind; onCreated: (record: any) => void; initialName?: string }) {
  const { toast } = useToast()
  const allowed = useCan(MODULE[kind], "create")
  const seesCost = useCan("product_cost", "view")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [categories, setCategories] = useState<any[]>([])
  const [form, setForm] = useState<Record<string, string>>({})
  if (!allowed) return null

  const start = async () => {
    setForm({ name: initialName })
    setError("")
    setOpen(true)
    if (kind === "product" && categories.length === 0) {
      const r = await fetch("/api/categories")
      if (r.ok) setCategories(await r.json())
    }
  }

  const save = async () => {
    setBusy(true)
    setError("")
    try {
      const body =
        kind === "product"
          ? { ...form, sellingPrice: form.sellingPrice || "0", ...(seesCost && { costPrice: form.costPrice || "0" }) }
          : form
      const res = await fetch(`/api/${MODULE[kind]}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not create it")
      toast({ title: `${TITLE[kind].replace("New ", "")[0].toUpperCase()}${TITLE[kind].replace("New ", "").slice(1)} created`, description: data.name })
      onCreated(data)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create it")
    } finally {
      setBusy(false)
    }
  }

  const field = (key: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`qc-${key}`}>{label}</Label>
      <Input id={`qc-${key}`} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  )
  const valid =
    !!form.name?.trim() &&
    (kind !== "supplier" || !!form.email?.trim()) &&
    (kind !== "product" || (!!form.sku?.trim() && !!form.categoryId))

  return (
    <>
      <Button type="button" variant="outline" size="icon" className="shrink-0" title={TITLE[kind]} onClick={start}>
        <Plus className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{TITLE[kind]}</DialogTitle>
            <DialogDescription>Only the essentials; more details can be added later on its page.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {field("name", "Name *", { autoFocus: true })}
            {kind !== "product" && field("phone", "Phone")}
            {kind === "customer" && field("email", "Email", { type: "email" })}
            {kind === "supplier" && field("email", "Email *", { type: "email" })}
            {kind !== "product" && field("address", "Address")}
            {kind === "product" && (
              <>
                {field("sku", "SKU *")}
                <div className="space-y-1">
                  <Label>Category *</Label>
                  <Select value={form.categoryId ?? ""} onValueChange={(categoryId) => setForm({ ...form, categoryId })}>
                    <SelectTrigger><SelectValue placeholder={categories.length ? "Choose a category" : "No categories yet"} /></SelectTrigger>
                    <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {field("sellingPrice", "Selling price", { type: "number", min: "0", step: "0.01" })}
                  {seesCost && field("costPrice", "Cost price", { type: "number", min: "0", step: "0.01" })}
                </div>
              </>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !valid} onClick={save}>{busy ? "Saving..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

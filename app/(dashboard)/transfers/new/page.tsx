"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"

interface Line {
  productId: string
  quantity: string
}

export default function NewTransferPage() {
  const { toast } = useToast()
  const router = useRouter()
  const canDispatch = useCan("stock_transfers", "edit")
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])
  const [fromWarehouseId, setFrom] = useState("")
  const [toWarehouseId, setTo] = useState("")
  const [expectedDate, setExpectedDate] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "1" }])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/warehouses").then(async (r) => r.ok && setWarehouses(await r.json()))
    fetch("/api/products").then(async (r) => r.ok && setProducts(await r.json()))
    fetch("/api/stock").then(async (r) => r.ok && setStock(await r.json()))
  }, [])

  const available = (productId: string) => {
    const row = stock.find((s) => s.productId === productId && s.warehouseId === fromWarehouseId)
    return row ? row.quantity - row.reservedQuantity : 0
  }
  const sourceProducts = products.filter((p) => stock.some((s) => s.productId === p.id && s.warehouseId === fromWarehouseId))
  const problems: string[] = []
  if (fromWarehouseId && fromWarehouseId === toWarehouseId) problems.push("Source and destination warehouse must differ.")
  lines.forEach((line, i) => {
    const qty = Number(line.quantity)
    if (line.productId && (!Number.isInteger(qty) || qty <= 0)) problems.push(`Line ${i + 1}: quantity must be a whole number above 0.`)
    if (line.productId && qty > available(line.productId)) {
      problems.push(`Line ${i + 1}: only ${available(line.productId)} available in the source.`)
    }
  })
  const seen = new Set<string>()
  lines.forEach((line) => {
    if (line.productId && seen.has(line.productId)) problems.push("Each product may appear only once.")
    seen.add(line.productId)
  })
  const ready = !!fromWarehouseId && !!toWarehouseId && lines.some((l) => l.productId) && fromWarehouseId !== toWarehouseId
  // Drafts may be saved even without enough stock (checked again at dispatch).
  const blocking = problems.filter((p) => !p.includes("available in the source"))

  const submit = async (mode: "DRAFT" | "DISPATCH" | "INSTANT") => {
    setSaving(true)
    try {
      const res = await fetch("/api/stock-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWarehouseId,
          toWarehouseId,
          expectedDate: expectedDate || null,
          notes,
          mode,
          items: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to create the transfer")
      toast({
        title: mode === "DRAFT" ? "Draft saved" : mode === "DISPATCH" ? "Transfer dispatched" : "Transfer completed",
        description: data.transferNumber,
      })
      router.push(`/transfers/${data.id}`)
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link href="/transfers"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Stock Transfer</h1>
          <p className="text-muted-foreground">Numbered automatically (TR-000001, ...).</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Route</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>From (source) *</Label>
            <Combobox
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              value={fromWarehouseId}
              onValueChange={(v) => { setFrom(v); setLines([{ productId: "", quantity: "1" }]) }}
              placeholder="Source warehouse"
            />
          </div>
          <div className="space-y-2">
            <Label>To (destination) *</Label>
            <Combobox
              options={warehouses.filter((w) => w.id !== fromWarehouseId).map((w) => ({ value: w.id, label: w.name }))}
              value={toWarehouseId}
              onValueChange={setTo}
              placeholder="Destination warehouse"
            />
          </div>
          <div className="space-y-2">
            <Label>Expected arrival</Label>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Available = quantity in the source minus reserved. Stock in transit cannot be sold.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="w-32 text-right">Quantity</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const avail = line.productId ? available(line.productId) : null
                const short = avail !== null && Number(line.quantity) > avail
                return (
                  <TableRow key={index}>
                    <TableCell>
                      <Combobox
                        options={sourceProducts.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                        value={line.productId}
                        onValueChange={(productId) => setLines(lines.map((l, i) => (i === index ? { ...l, productId } : l)))}
                        placeholder={fromWarehouseId ? "Select product" : "Choose the source first"}
                        disabled={!fromWarehouseId}
                      />
                    </TableCell>
                    <TableCell className={`text-right ${short ? "font-medium text-destructive" : ""}`}>{avail ?? "-"}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="1"
                        className="ml-auto h-9 w-24 text-right"
                        value={line.quantity}
                        onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, i) => i !== index))} disabled={lines.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Button variant="outline" onClick={() => setLines([...lines, { productId: "", quantity: "1" }])} disabled={!fromWarehouseId}>
            <Plus className="mr-2 h-4 w-4" /> Add item
          </Button>
          {problems.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => submit("DRAFT")} disabled={saving || !ready || blocking.length > 0}>
          Save draft
        </Button>
        {canDispatch && (
          <>
            <Button onClick={() => submit("DISPATCH")} disabled={saving || !ready || problems.length > 0}>
              Dispatch now
            </Button>
            <Button variant="secondary" onClick={() => submit("INSTANT")} disabled={saving || !ready || problems.length > 0}>
              Instant transfer (dispatch + receive)
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

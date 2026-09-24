"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Eye, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCan } from "@/components/providers/current-user-provider"
import { formatDate } from "@/lib/utils"
import { TRANSFER_STATUS } from "@/lib/transfer-labels"

const sum = (items: any[], key: string) => items.reduce((s, i) => s + (i[key] || 0), 0)

export default function TransfersPage() {
  const canCreate = useCan("stock_transfers", "create")
  const [transfers, setTransfers] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ status: "all", warehouseId: "all", from: "", to: "" })

  useEffect(() => {
    fetch("/api/warehouses").then(async (r) => r.ok && setWarehouses(await r.json()))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.status !== "all") params.set("status", filters.status)
    if (filters.warehouseId !== "all") params.set("warehouseId", filters.warehouseId)
    if (filters.from) params.set("from", filters.from)
    if (filters.to) params.set("to", filters.to)
    setLoading(true)
    fetch(`/api/stock-transfers?${params}`)
      .then(async (r) => setTransfers(r.ok ? await r.json() : []))
      .finally(() => setLoading(false))
  }, [filters])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stock Transfers</h1>
          <p className="text-muted-foreground">Move goods between warehouses, with goods in transit tracked separately.</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/transfers/new">
              <Plus className="mr-2 h-4 w-4" /> New Transfer
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={filters.status} onValueChange={(status) => setFilters({ ...filters, status })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(TRANSFER_STATUS).map(([value, s]) => (
                  <SelectItem key={value} value={value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Warehouse (from or to)</Label>
            <Select value={filters.warehouseId} onValueChange={(warehouseId) => setFilters({ ...filters, warehouseId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>From date</Label>
            <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>To date</Label>
            <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transfers</CardTitle>
          <CardDescription>{transfers.length} transfer(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">In transit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>By</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : transfers.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No transfers found.</TableCell></TableRow>
              ) : (
                transfers.map((t) => {
                  const inTransit = sum(t.items, "dispatchedQuantity") - sum(t.items, "receivedQuantity") - sum(t.items, "lostQuantity") - sum(t.items, "returnedQuantity")
                  const status = TRANSFER_STATUS[t.status]
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        {t.transferNumber}
                        {t.instant && <Badge variant="outline" className="ml-2">Instant</Badge>}
                      </TableCell>
                      <TableCell>{t.fromWarehouse?.name}</TableCell>
                      <TableCell>{t.toWarehouse?.name}</TableCell>
                      <TableCell>{formatDate(t.transferDate)}</TableCell>
                      <TableCell className="text-right">{sum(t.items, "quantity")}</TableCell>
                      <TableCell className="text-right">{inTransit || "-"}</TableCell>
                      <TableCell><Badge variant={status?.variant}>{status?.label ?? t.status}</Badge></TableCell>
                      <TableCell>{t.user?.username}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="icon" title="Open">
                          <Link href={`/transfers/${t.id}`}><Eye className="h-4 w-4" /></Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

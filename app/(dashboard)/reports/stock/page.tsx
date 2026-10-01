"use client"

import { useEffect, useState } from "react"
import { Download, FileSpreadsheet, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CompanyHeader } from "@/components/company-header"
import { formatCurrency, formatUnitCost } from "@/lib/utils"
import { downloadCsv, downloadXlsx, moneyCell, type Cell } from "@/lib/export-file"

const ALL = "__all"

// Stock report: what is on hand, reserved and available per warehouse and
// product, with its value at average cost (roles that see costs).
export default function StockReportPage() {
  const [warehouseId, setWarehouseId] = useState(ALL)
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<any | null>(null)

  useEffect(() => {
    fetch("/api/warehouses").then(async (r) => r.ok && setWarehouses(await r.json()))
  }, [])
  useEffect(() => {
    fetch(`/api/reports/stock${warehouseId === ALL ? "" : `?warehouseId=${warehouseId}`}`).then(async (r) => r.ok && setData(await r.json()))
  }, [warehouseId])

  const seesCost = !!data?.seesCost
  const rows = (): Cell[][] => [
    ["Warehouse", "SKU", "Product", "Category", "On hand", "Reserved", "Available", "Reorder level", ...(seesCost ? ["Avg cost", "Value"] : [])],
    ...(data?.rows ?? []).map((r: any) => [
      r.warehouse, r.sku, r.name, r.category, r.quantity, r.reserved, r.available, r.reorderLevel,
      ...(seesCost ? [Number(r.avgCost), moneyCell(r.value)] : []),
    ]),
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stock report</h1>
          <p className="text-muted-foreground">On hand, reserved for customers and available, per warehouse and product</p>
        </div>
        <div className="flex items-end gap-2 print:hidden">
          <div className="w-56 space-y-1">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All warehouses</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={!data} onClick={() => downloadCsv("stock_report.csv", rows())}><Download className="mr-2 h-4 w-4" /> CSV</Button>
          <Button variant="outline" disabled={!data} onClick={() => downloadXlsx("stock_report.xlsx", [{ name: "Stock", rows: rows() }])}><FileSpreadsheet className="mr-2 h-4 w-4" /> Excel</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
        </div>
      </div>
      <CompanyHeader align="left" className="hidden print:flex" />

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>Units on hand</CardDescription><CardTitle className="text-2xl">{data.totals.quantity.toLocaleString()}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Reserved for customers</CardDescription><CardTitle className="text-2xl">{data.totals.reserved.toLocaleString()}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>At or below reorder level</CardDescription><CardTitle className="text-2xl">{data.totals.lowCount}</CardTitle></CardHeader></Card>
          {seesCost && <Card><CardHeader className="pb-2"><CardDescription>Stock value (avg cost)</CardDescription><CardTitle className="text-2xl">{formatCurrency(data.totals.value)}</CardTitle></CardHeader></Card>}
        </div>
      )}

      {data && data.warehouses.length > 1 && (
        <Card>
          <CardHeader><CardTitle>By warehouse</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  {seesCost && <TableHead className="text-right">Value</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.warehouses.map((w: any) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-right">{w.products}</TableCell>
                    <TableCell className="text-right">{w.quantity.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{w.reserved.toLocaleString()}</TableCell>
                    {seesCost && <TableCell className="text-right">{formatCurrency(w.value)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>By product</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                {seesCost && <TableHead className="text-right">Avg cost</TableHead>}
                {seesCost && <TableHead className="text-right">Value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : data.rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No stock yet. Receive a purchase order to add stock.</TableCell></TableRow>
              ) : (
                data.rows.map((r: any) => (
                  <TableRow key={`${r.productId}-${r.warehouseId}`}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.sku} · {r.category}</div>
                    </TableCell>
                    <TableCell>{r.warehouse}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">{r.reserved || "-"}</TableCell>
                    <TableCell className="text-right">
                      {r.available}
                      {r.low && <Badge variant="warning" className="ml-2">Low</Badge>}
                    </TableCell>
                    {seesCost && <TableCell className="text-right">{formatUnitCost(r.avgCost)}</TableCell>}
                    {seesCost && <TableCell className="text-right">{formatCurrency(r.value)}</TableCell>}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

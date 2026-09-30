"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Download, FileSpreadsheet, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { downloadCsv, downloadXlsx, moneyCell, type Cell } from "@/lib/export-file"

const iso = (d: Date) => d.toISOString().slice(0, 10)
function presetRange(preset: string): [string, string] {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd))
  switch (preset) {
    case "last_month":
      return [iso(utc(y, m - 1, 1)), iso(utc(y, m, 0))]
    case "this_quarter":
      return [iso(utc(y, Math.floor(m / 3) * 3, 1)), iso(now)]
    case "this_year":
      return [iso(utc(y, 0, 1)), iso(now)]
    case "last_year":
      return [iso(utc(y - 1, 0, 1)), iso(utc(y - 1, 11, 31))]
    default:
      return [iso(utc(y, m, 1)), iso(now)]
  }
}

const pct = (v: unknown) => (v === null || v === undefined ? "-" : `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(1)}%`)

// Profit & Loss from the journal, compared with the previous period.
export default function ProfitLossPage() {
  const { toast } = useToast()
  const [preset, setPreset] = useState("this_month")
  const [[from, to], setRange] = useState<[string, string]>(presetRange("this_month"))
  const [data, setData] = useState<any | null>(null)

  useEffect(() => {
    fetch(`/api/reports/profit-loss?${new URLSearchParams({ from, to })}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || "Failed to load the report")
        setData(body)
      })
      .catch((e) => toast({ title: "Error", description: e.message, variant: "destructive" }))
  }, [from, to, toast])

  const prevLabel = data ? `${formatDate(data.previousPeriod.from)} - ${formatDate(data.previousPeriod.to)}` : "Previous period"
  const section = (key: string) => data?.sections.find((s: any) => s.key === key)

  // One table model for the screen, CSV and Excel.
  type Line = { label: string; current?: any; previous?: any; change?: any; changePercent?: any; kind: "heading" | "line" | "subtotal" | "total"; minus?: boolean }
  const model = (): Line[] => {
    if (!data) return []
    const out: Line[] = []
    const addSection = (key: string, minus: boolean) => {
      const s = section(key)
      if (!s || s.lines.length === 0) return
      out.push({ label: s.label, kind: "heading" })
      for (const l of s.lines) out.push({ label: `${l.code} ${l.name}`, current: l.current, previous: l.previous, change: l.change, changePercent: l.changePercent, kind: "line", minus })
      if (s.lines.length > 1) out.push({ label: `Total ${s.label.toLowerCase()}`, current: s.current, previous: s.previous, change: s.change, changePercent: s.changePercent, kind: "subtotal", minus })
    }
    const t = data.totals
    addSection("sales", false)
    addSection("salesReturns", true)
    out.push({ label: "Net sales", ...t.netSales, kind: "total" })
    addSection("cogs", true)
    out.push({ label: "Gross profit", ...t.grossProfit, kind: "total" })
    addSection("otherIncome", false)
    addSection("operatingExpenses", true)
    addSection("losses", true)
    addSection("otherExpenses", true)
    out.push({ label: "Net profit", ...t.netProfit, kind: "total" })
    return out
  }
  const rows = model()

  const table = (): Cell[][] => [
    ["Profit & Loss", `${from} to ${to}`, `Previous: ${prevLabel}`],
    ["Line", "Current period", "Previous period", "Change", "Change %"],
    ...rows.map((r) =>
      r.kind === "heading"
        ? [r.label]
        : [r.label, moneyCell(r.minus ? -Number(r.current) : r.current), moneyCell(r.minus ? -Number(r.previous) : r.previous), moneyCell(r.minus ? -Number(r.change) : r.change), r.changePercent === null ? "" : Number(r.changePercent)]
    ),
    [],
    ["Gross margin %", data?.totals.grossMargin.current === null ? "" : Number(data?.totals.grossMargin.current), data?.totals.grossMargin.previous === null ? "" : Number(data?.totals.grossMargin.previous)],
    ["Net margin %", data?.totals.netMargin.current === null ? "" : Number(data?.totals.netMargin.current), data?.totals.netMargin.previous === null ? "" : Number(data?.totals.netMargin.previous)],
  ]

  const t = data?.totals

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image src="/siu_logo.png" alt="SIU" width={48} height={48} className="hidden h-12 w-auto print:block" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Profit &amp; Loss</h1>
            <p className="text-muted-foreground">
              {from} to {to} · compared with {prevLabel}
              {data?.scope === "OWN" && " · your own transactions"}
            </p>
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" disabled={!data} onClick={() => downloadCsv(`profit_loss_${from}_${to}.csv`, table())}><Download className="mr-2 h-4 w-4" /> CSV</Button>
          <Button variant="outline" disabled={!data} onClick={() => downloadXlsx(`profit_loss_${from}_${to}.xlsx`, [{ name: "Profit & Loss", rows: table() }])}><FileSpreadsheet className="mr-2 h-4 w-4" /> Excel</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Period</Label>
            <Select value={preset} onValueChange={(p) => { setPreset(p); if (p !== "custom") setRange(presetRange(p)) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">This month</SelectItem>
                <SelectItem value="last_month">Last month</SelectItem>
                <SelectItem value="this_quarter">This quarter</SelectItem>
                <SelectItem value="this_year">This year</SelectItem>
                <SelectItem value="last_year">Last year</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>From</Label><Input type="date" value={from} max={to} onChange={(e) => { setPreset("custom"); setRange([e.target.value || from, to]) }} /></div>
          <div className="space-y-1"><Label>To</Label><Input type="date" value={to} min={from} onChange={(e) => { setPreset("custom"); setRange([from, e.target.value || to]) }} /></div>
        </CardContent>
      </Card>

      {t && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Net sales", t.netSales, null],
            ["Gross profit", t.grossProfit, t.grossMargin.current],
            ["Operating expenses", section("operatingExpenses"), null],
            ["Net profit", t.netProfit, t.netMargin.current],
          ].map(([label, v, margin]: any) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardDescription>{label}</CardDescription>
                <CardTitle className={`text-2xl ${label === "Net profit" && Number(v.current) < 0 ? "text-destructive" : ""}`}>{formatCurrency(v.current)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {margin !== null && `${Number(margin).toFixed(1)}% margin · `}
                previous {formatCurrency(v.previous)} ({pct(v.changePercent)})
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Statement</CardTitle>
          <CardDescription>Built from the journal: sales and returns at delivery / credit note, cost of goods sold at the original cost, expenses by expense account.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="text-right">Current period</TableHead>
                <TableHead className="text-right">Previous period</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : (
                rows.map((r, i) =>
                  r.kind === "heading" ? (
                    <TableRow key={i} className="bg-muted/40"><TableCell colSpan={5} className="font-semibold">{r.label}</TableCell></TableRow>
                  ) : (
                    <TableRow key={i} className={r.kind === "total" ? "border-t-2 font-bold" : r.kind === "subtotal" ? "font-medium" : ""}>
                      <TableCell className={r.kind === "line" ? "pl-8" : ""}>{r.label}</TableCell>
                      {[r.current, r.previous, r.change].map((v, j) => (
                        <TableCell key={j} className={`text-right ${r.kind === "total" && Number(v) < 0 ? "text-destructive" : ""}`}>
                          {r.minus ? `(${formatCurrency(v)})` : formatCurrency(v)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right text-muted-foreground">{pct(r.changePercent)}</TableCell>
                    </TableRow>
                  )
                )
              )}
              {t && (
                <>
                  <TableRow><TableCell className="text-muted-foreground">Gross margin</TableCell><TableCell className="text-right text-muted-foreground">{t.grossMargin.current === null ? "-" : `${Number(t.grossMargin.current).toFixed(1)}%`}</TableCell><TableCell className="text-right text-muted-foreground">{t.grossMargin.previous === null ? "-" : `${Number(t.grossMargin.previous).toFixed(1)}%`}</TableCell><TableCell colSpan={2} /></TableRow>
                  <TableRow><TableCell className="text-muted-foreground">Net margin</TableCell><TableCell className="text-right text-muted-foreground">{t.netMargin.current === null ? "-" : `${Number(t.netMargin.current).toFixed(1)}%`}</TableCell><TableCell className="text-right text-muted-foreground">{t.netMargin.previous === null ? "-" : `${Number(t.netMargin.previous).toFixed(1)}%`}</TableCell><TableCell colSpan={2} /></TableRow>
                </>
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">Amounts in brackets are deducted. The previous period is the same number of days just before the selected period.</p>
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Download, FileSpreadsheet, Printer } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { PAYMENT_METHODS, methodLabel } from "@/lib/payment-methods"
import { downloadCsv, downloadXlsx, moneyCell, type Cell } from "@/lib/export-file"

const ALL = "__all"
const today = () => new Date().toISOString().slice(0, 10)
const yearStart = () => `${new Date().getFullYear()}-01-01`
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })

// Expense reports: by category, payment method, user and month, for any
// period, with totals / averages, CSV and Excel export and print.
export default function ExpenseReportsPage() {
  const { toast } = useToast()
  const [from, setFrom] = useState(yearStart())
  const [to, setTo] = useState(today())
  const [categoryId, setCategoryId] = useState(ALL)
  const [paymentMethod, setPaymentMethod] = useState(ALL)
  const [userId, setUserId] = useState(ALL)
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const qs = new URLSearchParams({ from, to })
    if (categoryId !== ALL) qs.set("categoryId", categoryId)
    if (paymentMethod !== ALL) qs.set("paymentMethod", paymentMethod)
    if (userId !== ALL) qs.set("userId", userId)
    setLoading(true)
    fetch(`/api/reports/expenses?${qs}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || "Failed to load the report")
        setData(body)
      })
      .catch((e) => toast({ title: "Error", description: e.message, variant: "destructive" }))
      .finally(() => setLoading(false))
  }, [from, to, categoryId, paymentMethod, userId, toast])

  const chart = useMemo(() => (data?.monthly ?? []).map((m: any) => ({ month: monthLabel(m.month), total: Number(m.total), count: m.count })), [data])
  const t = data?.totals
  const filterText = [
    `${from} to ${to}`,
    categoryId !== ALL && `category ${data?.options.categories.find((c: any) => c.id === categoryId)?.name ?? ""}`,
    paymentMethod !== ALL && `method ${methodLabel(paymentMethod)}`,
    userId !== ALL && `user ${data?.options.users.find((u: any) => u.id === userId)?.username ?? ""}`,
  ]
    .filter(Boolean)
    .join(" · ")

  const sheets = (): { name: string; rows: Cell[][] }[] => [
    {
      name: "Summary",
      rows: [
        ["Expense report", filterText],
        ["Total", moneyCell(t.total)],
        ["Number of expenses", t.count],
        ["Average per expense", moneyCell(t.averagePerExpense)],
        ["Months", t.months],
        ["Average per month", moneyCell(t.averagePerMonth)],
        ["Largest expense", moneyCell(t.largest)],
      ],
    },
    { name: "By category", rows: [["Category", "Expenses", "Total", "Share %"], ...data.byCategory.map((r: any) => [r.label, r.count, moneyCell(r.total), Number(r.share)])] },
    { name: "By payment method", rows: [["Payment method", "Expenses", "Total", "Share %"], ...data.byPaymentMethod.map((r: any) => [methodLabel(r.label), r.count, moneyCell(r.total), Number(r.share)])] },
    { name: "By user", rows: [["User", "Expenses", "Total", "Share %"], ...data.byUser.map((r: any) => [r.label, r.count, moneyCell(r.total), Number(r.share)])] },
    { name: "By month", rows: [["Month", "Expenses", "Total"], ...data.monthly.map((m: any) => [m.month, m.count, moneyCell(m.total)])] },
    {
      name: "Expenses",
      rows: [
        ["Date", "Category", "Description", "Payment method", "Reference", "User", "Amount"],
        ...data.rows.map((r: any) => [String(r.expenseDate).slice(0, 10), r.category, r.description, methodLabel(r.paymentMethod), r.reference ?? "", r.username, moneyCell(r.amount)]),
      ],
    },
  ]

  const breakdown = (title: string, rows: any[], label: (r: any) => string) => (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{title.replace("By ", "").replace(/^./, (c) => c.toUpperCase())}</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No expenses</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{label(r)}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.total)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted print:hidden">
                        <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${Number(r.share)}%` }} />
                      </div>
                      {Number(r.share).toFixed(1)}%
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image src="/siu_logo.png" alt="SIU" width={48} height={48} className="hidden h-12 w-auto print:block" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Expense reports</h1>
            <p className="text-muted-foreground">{filterText}{data?.scope === "OWN" && " · your own expenses"}</p>
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" disabled={!data} onClick={() => downloadCsv(`expenses_${from}_${to}.csv`, sheets()[5].rows)}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" disabled={!data} onClick={() => downloadXlsx(`expenses_${from}_${to}.xlsx`, sheets())}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
        </div>
      </div>

      {/* Filters: one row above the charts. */}
      <Card className="print:hidden">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1"><Label>From</Label><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || yearStart())} /></div>
          <div className="space-y-1"><Label>To</Label><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || today())} /></div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {data?.options.categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Payment method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All methods</SelectItem>
                {PAYMENT_METHODS.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>User</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All users</SelectItem>
                {data?.options.users.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!data ? (
        <p className="py-12 text-center text-muted-foreground">{loading ? "Loading..." : "No data"}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardDescription>Total expenses</CardDescription><CardTitle className="text-2xl">{formatCurrency(t.total)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{t.count} expense(s)</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Average per month</CardDescription><CardTitle className="text-2xl">{formatCurrency(t.averagePerMonth)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">over {t.months} month(s)</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Average per expense</CardDescription><CardTitle className="text-2xl">{formatCurrency(t.averagePerExpense)}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Largest expense</CardDescription><CardTitle className="text-2xl">{formatCurrency(t.largest)}</CardTitle></CardHeader></Card>
          </div>

          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>Monthly trend</CardTitle>
              <CardDescription>Total expenses per month</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} width={70} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, color: "hsl(var(--popover-foreground))" }}
                      formatter={(value: number, _n, item: any) => [`${formatCurrency(value)} (${item.payload.count} expense(s))`, "Expenses"]}
                    />
                    <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            {breakdown("By category", data.byCategory, (r) => r.label)}
            {breakdown("By payment method", data.byPaymentMethod, (r) => methodLabel(r.label))}
            {breakdown("By user", data.byUser, (r) => r.label)}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
              <CardDescription>{data.rowsTruncated ? "The newest 2,000 expenses (totals above include all)" : `${data.rows.length} expense(s)`}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>{formatDate(r.expenseDate)}</TableCell>
                      <TableCell>{r.category}</TableCell>
                      <TableCell className="max-w-[280px]">{r.description}{r.reference && <div className="text-xs text-muted-foreground">Ref {r.reference}</div>}</TableCell>
                      <TableCell>{methodLabel(r.paymentMethod)}</TableCell>
                      <TableCell>{r.username}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell colSpan={5}>Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(t.total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

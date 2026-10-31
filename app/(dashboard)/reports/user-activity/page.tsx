"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Download, FileSpreadsheet, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PaginationControls } from "@/components/ui/pagination-controls"
import { useToast } from "@/components/ui/use-toast"
import { CompanyHeader } from "@/components/company-header"
import { formatCurrency, formatDateTime } from "@/lib/utils"
import { ROLE_LABELS } from "@/lib/permission-rules"
import { ACTIVITY_AREAS, ACTIVITY_AREA_LABELS, type ActivityArea, activityKindLabel } from "@/lib/user-activity-rules"
import { downloadCsv, downloadXlsx, moneyCell, type Cell } from "@/lib/export-file"

const ALL = "__all"
const PAGE_SIZE = 50
const EXPORT_PAGE_SIZE = 200
const EXPORT_LIMIT = 10000
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const today = () => isoDay(new Date())
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86400000))

type UserOption = { id: string; username: string; name: string; role: keyof typeof ROLE_LABELS; status: string }

async function getJson(url: string) {
  const r = await fetch(url)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || "Failed to load the report")
  return body
}

// User activity report (admin only): pick a user by username, name or role
// and see everything they recorded, filtered by area, period, warehouse and
// text, with totals per area and kind, CSV / Excel export and print.
export default function UserActivityReportPage() {
  const { toast } = useToast()
  const [users, setUsers] = useState<UserOption[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [userId, setUserId] = useState("")
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(today())
  const [areas, setAreas] = useState<ActivityArea[]>([...ACTIVITY_AREAS])
  const [warehouseId, setWarehouseId] = useState(ALL)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    getJson("/api/reports/user-activity?options=1")
      .then((body) => {
        setUsers(body.users)
        setWarehouses(body.warehouses)
        const preset = new URLSearchParams(window.location.search).get("userId")
        if (preset) setUserId(preset)
      })
      .catch((e) => toast({ title: "Error", description: e.message, variant: "destructive" }))
  }, [toast])

  // Search text is sent after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => setPage(1), [userId, from, to, areas, warehouseId, q])

  const query = useMemo(() => {
    const qs = new URLSearchParams({ userId, from, to, areas: areas.join(",") })
    if (warehouseId !== ALL) qs.set("warehouseId", warehouseId)
    if (q) qs.set("q", q)
    return qs
  }, [userId, from, to, areas, warehouseId, q])

  useEffect(() => {
    if (!userId || areas.length === 0) {
      setData(null)
      return
    }
    const qs = new URLSearchParams(query)
    qs.set("page", String(page))
    qs.set("pageSize", String(PAGE_SIZE))
    // A slower earlier response must not overwrite a newer one.
    let current = true
    setLoading(true)
    getJson(`/api/reports/user-activity?${qs}`)
      .then((body) => current && setData(body))
      .catch((e) => current && toast({ title: "Error", description: e.message, variant: "destructive" }))
      .finally(() => current && setLoading(false))
    return () => {
      current = false
    }
  }, [query, page, userId, areas.length, toast])

  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: `${u.name} (${u.username}) · ${ROLE_LABELS[u.role] ?? u.role}${u.status !== "APPROVED" ? ` · ${u.status.toLowerCase()}` : ""}` })),
    [users]
  )

  const toggleArea = (a: ActivityArea) =>
    setAreas((current) => (current.includes(a) ? current.filter((x) => x !== a) : ACTIVITY_AREAS.filter((x) => x === a || current.includes(x))))

  const filterText = data
    ? [
        `${data.user.name} (${data.user.username})`,
        `${from} to ${to}`,
        areas.length < ACTIVITY_AREAS.length && areas.map((a) => ACTIVITY_AREA_LABELS[a]).join(", "),
        warehouseId !== ALL && `warehouse ${warehouses.find((w) => w.id === warehouseId)?.name ?? ""}`,
        q && `"${q}"`,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  /** All matching rows (not just this page), for export. */
  const loadAllRows = async (): Promise<any[]> => {
    const rows: any[] = []
    for (let p = 1; rows.length < EXPORT_LIMIT; p++) {
      const qs = new URLSearchParams(query)
      qs.set("page", String(p))
      qs.set("pageSize", String(EXPORT_PAGE_SIZE))
      const body = await getJson(`/api/reports/user-activity?${qs}`)
      rows.push(...body.rows)
      if (body.rows.length < EXPORT_PAGE_SIZE) break
    }
    return rows
  }

  const exportFile = async (format: "csv" | "xlsx") => {
    if (!data) return
    setExporting(true)
    try {
      const rows = await loadAllRows()
      const activity: Cell[][] = [
        ["Date", "Area", "Activity", "Reference", "Details", "Warehouse", "Quantity", "Amount"],
        ...rows.map((r) => [
          formatDateTime(r.at),
          ACTIVITY_AREA_LABELS[r.area as ActivityArea] ?? r.area,
          activityKindLabel(r.kind),
          r.ref ?? "",
          r.detail ?? "",
          r.warehouse ?? "",
          r.quantity ?? "",
          r.amount === null ? "" : moneyCell(r.amount),
        ]),
      ]
      const name = `user-activity_${data.user.username}_${from}_${to}`
      if (format === "csv") return downloadCsv(`${name}.csv`, activity)
      downloadXlsx(`${name}.xlsx`, [
        {
          name: "Summary",
          rows: [
            ["User activity report", filterText],
            ["User", `${data.user.name} (${data.user.username})`],
            ["Role", ROLE_LABELS[data.user.role as keyof typeof ROLE_LABELS] ?? data.user.role],
            ["Activities", data.totals.count],
            [],
            ["Area", "Activity", "Count", "Quantity", "Amount"],
            ...data.byKind.map((k: any) => [ACTIVITY_AREA_LABELS[k.area as ActivityArea] ?? k.area, activityKindLabel(k.kind), k.count, k.quantity ?? "", k.amount === null ? "" : moneyCell(k.amount)]),
          ],
        },
        { name: "Activity", rows: activity },
      ])
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CompanyHeader align="left" className="hidden print:flex" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">User activity</h1>
            <p className="text-muted-foreground">{filterText || "Everything a user recorded in the system"}</p>
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" disabled={!data || exporting} onClick={() => exportFile("csv")}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" disabled={!data || exporting} onClick={() => exportFile("xlsx")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" disabled={!data} onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1 lg:col-span-2">
              <Label>User</Label>
              <SearchableSelect
                options={userOptions}
                value={userId}
                onValueChange={setUserId}
                placeholder="Select a user..."
                searchPlaceholder="Search username, name or role..."
                emptyMessage="No user found."
              />
            </div>
            <div className="space-y-1"><Label>From</Label><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || daysAgo(29))} /></div>
            <div className="space-y-1"><Label>To</Label><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || today())} /></div>
            <div className="space-y-1">
              <Label>Warehouse</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All warehouses</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-5">
            <div className="space-y-1 lg:col-span-2">
              <Label>Search</Label>
              <Input placeholder="Order / reference number, customer, supplier, product..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="space-y-1 lg:col-span-3">
              <Label>Areas</Label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={areas.length === ACTIVITY_AREAS.length ? "default" : "outline"} onClick={() => setAreas([...ACTIVITY_AREAS])}>All</Button>
                {ACTIVITY_AREAS.map((a) => (
                  <Button key={a} size="sm" variant={areas.includes(a) ? "secondary" : "outline"} className={areas.includes(a) ? "ring-1 ring-primary" : ""} onClick={() => toggleArea(a)}>
                    {ACTIVITY_AREA_LABELS[a]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!userId ? (
        <p className="py-12 text-center text-muted-foreground">Select a user to see their activity.</p>
      ) : areas.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">Select at least one area.</p>
      ) : !data ? (
        <p className="py-12 text-center text-muted-foreground">{loading ? "Loading..." : "No data"}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>User</CardDescription>
                <CardTitle className="text-xl">{data.user.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{data.user.username}</span>
                <Badge variant="outline">{ROLE_LABELS[data.user.role as keyof typeof ROLE_LABELS] ?? data.user.role}</Badge>
                {data.user.status !== "APPROVED" && <Badge variant="warning">{data.user.status}</Badge>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>Activities</CardDescription><CardTitle className="text-2xl">{data.totals.count}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">in {data.byKind.length} kind(s) of work</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>First activity</CardDescription><CardTitle className="text-lg">{data.totals.first ? formatDateTime(data.totals.first) : "—"}</CardTitle></CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>Last activity</CardDescription><CardTitle className="text-lg">{data.totals.last ? formatDateTime(data.totals.last) : "—"}</CardTitle></CardHeader>
            </Card>
          </div>

          {data.byArea.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.byArea.map((a: any) => (
                <Card key={a.area} className="break-inside-avoid">
                  <CardHeader className="pb-2">
                    <CardDescription>{ACTIVITY_AREA_LABELS[a.area as ActivityArea] ?? a.area}</CardDescription>
                    <CardTitle className="text-2xl">{a.count}</CardTitle>
                  </CardHeader>
                  {Number(a.amount) !== 0 && <CardContent className="text-xs text-muted-foreground">{formatCurrency(a.amount)} total value</CardContent>}
                </Card>
              ))}
            </div>
          )}

          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>By kind of work</CardTitle>
              <CardDescription>Count, quantity and value of each kind of record</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Area</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Last</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byKind.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No activity in this period</TableCell></TableRow>
                  ) : (
                    data.byKind.map((k: any) => (
                      <TableRow key={k.kind}>
                        <TableCell>{ACTIVITY_AREA_LABELS[k.area as ActivityArea] ?? k.area}</TableCell>
                        <TableCell>{activityKindLabel(k.kind)}</TableCell>
                        <TableCell className="text-right">{k.count}</TableCell>
                        <TableCell className="text-right">{k.quantity ?? "—"}</TableCell>
                        <TableCell className="text-right">{k.amount === null ? "—" : formatCurrency(k.amount)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(k.last)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>Newest first{loading && " · updating..."}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No activity matches the filters</TableCell></TableRow>
                  ) : (
                    data.rows.map((r: any) => (
                      <TableRow key={`${r.kind}-${r.id}`}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.at)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{activityKindLabel(r.kind)}</div>
                          <div className="text-xs text-muted-foreground">{ACTIVITY_AREA_LABELS[r.area as ActivityArea] ?? r.area}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.href ? <Link href={r.href} className="text-primary hover:underline">{r.ref || "Open"}</Link> : r.ref || "—"}
                        </TableCell>
                        <TableCell className="max-w-md text-sm">{r.detail ?? ""}</TableCell>
                        <TableCell className="text-sm">{r.warehouse ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.quantity ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.amount === null ? "—" : formatCurrency(r.amount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <div className="print:hidden">
                <PaginationControls page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

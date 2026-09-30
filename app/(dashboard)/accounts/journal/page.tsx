"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { SOURCE_LABEL } from "@/lib/account-labels"

const ALL = "__all"

// Journal: every automatic entry with its debit and credit lines.
export default function JournalPage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sourceType, setSourceType] = useState(ALL)
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<any | null>(null)

  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page) })
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    if (sourceType !== ALL) qs.set("sourceType", sourceType)
    if (q.trim()) qs.set("q", q.trim())
    const timer = setTimeout(() => fetch(`/api/accounts/journal?${qs}`).then(async (r) => r.ok && setData(await r.json())), 250)
    return () => clearTimeout(timer)
  }, [from, to, sourceType, q, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" className="-ml-4"><Link href="/accounts"><ArrowLeft className="mr-2 h-4 w-4" /> Chart of accounts</Link></Button>
        <h1 className="text-3xl font-bold tracking-tight">Journal</h1>
        <p className="text-muted-foreground">Entries are never edited: a change to a document posts a correcting entry</p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label>From</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} /></div>
          <div className="space-y-1"><Label>To</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} /></div>
          <div className="space-y-1">
            <Label>Source</Label>
            <Select value={sourceType} onValueChange={(v) => { setSourceType(v); setPage(1) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {Object.entries(SOURCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Search</Label><Input value={q} placeholder="JE number, description, reference" onChange={(e) => { setQ(e.target.value); setPage(1) }} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : data.entries.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No journal entries.</TableCell></TableRow>
              ) : (
                data.entries.flatMap((e: any) => [
                  <TableRow key={e.id} className="bg-muted/40">
                    <TableCell colSpan={5} className="py-2">
                      <span className="font-mono font-medium">{e.entryNumber}</span>
                      <span className="mx-2 text-muted-foreground">{formatDate(e.date)}</span>
                      <Badge variant="outline">{SOURCE_LABEL[e.sourceType] ?? e.sourceType}</Badge>
                      {e.isAdjustment && <Badge variant="warning" className="ml-2">correction</Badge>}
                      <span className="ml-2">{e.description}</span>
                      {e.reference && <span className="ml-2 text-muted-foreground">({e.reference})</span>}
                      {e.user && <span className="ml-2 text-xs text-muted-foreground">by {e.user.username}</span>}
                    </TableCell>
                  </TableRow>,
                  ...e.lines.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell />
                      <TableCell />
                      <TableCell className={Number(l.credit) > 0 ? "pl-8" : ""}>
                        <Link href={`/accounts/${l.account.id}`} className="hover:underline">{l.account.code} {l.account.name}</Link>
                        {l.memo && <span className="ml-2 text-xs text-muted-foreground">{l.memo}</span>}
                      </TableCell>
                      <TableCell className="text-right">{Number(l.debit) ? formatCurrency(l.debit) : ""}</TableCell>
                      <TableCell className="text-right">{Number(l.credit) ? formatCurrency(l.credit) : ""}</TableCell>
                    </TableRow>
                  )),
                ])
              )}
            </TableBody>
          </Table>
          {data && data.total > data.pageSize && (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span>Page {page} of {pages} · {data.total} entries</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

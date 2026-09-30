"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/utils"
import { GROUP_LABEL, SOURCE_LABEL, TYPE_LABEL } from "@/lib/account-labels"
import { downloadCsv, moneyCell } from "@/lib/export-file"

// Account ledger: opening balance, every line with a running balance, closing balance.
export default function AccountLedgerPage() {
  const { id } = useParams<{ id: string }>()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [data, setData] = useState<any | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    fetch(`/api/accounts/${id}/ledger?${qs}`).then(async (r) => {
      const body = await r.json().catch(() => ({}))
      if (r.ok) setData(body)
      else setError(body.error || "Failed to load the ledger")
    })
  }, [id, from, to])

  if (error) return <p className="py-12 text-center text-destructive">{error}</p>
  if (!data) return <p className="py-12 text-center text-muted-foreground">Loading...</p>
  const a = data.account

  const exportCsv = () =>
    downloadCsv(`ledger_${a.code}.csv`, [
      ["Date", "Entry", "Source", "Description", "Reference", "Debit", "Credit", "Balance"],
      ["", "", "", "Opening balance", "", "", "", moneyCell(data.openingBalance)],
      ...data.rows.map((r: any) => [String(r.date).slice(0, 10), r.entryNumber, SOURCE_LABEL[r.sourceType] ?? r.sourceType, r.description, r.reference ?? "", moneyCell(r.debit), moneyCell(r.credit), moneyCell(r.balance)]),
      ["", "", "", "Closing balance", "", moneyCell(data.totalDebit), moneyCell(data.totalCredit), moneyCell(data.closingBalance)],
    ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Button asChild variant="ghost" className="-ml-4"><Link href="/accounts"><ArrowLeft className="mr-2 h-4 w-4" /> Chart of accounts</Link></Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" /> CSV</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">Ledger {a.code} {a.name}</CardTitle>
              <CardDescription>{TYPE_LABEL[a.type]} · {GROUP_LABEL[a.group]}{from || to ? ` · ${from || "start"} to ${to || "today"}` : ""}</CardDescription>
            </div>
            <div className="flex gap-2 print:hidden">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40">
                <TableCell colSpan={5} className="font-medium">Opening balance</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(data.openingBalance)}</TableCell>
              </TableRow>
              {data.rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                  <TableCell className="font-mono">{r.entryNumber}</TableCell>
                  <TableCell>
                    {r.description}
                    <div className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[r.sourceType] ?? r.sourceType}{r.reference && ` · ${r.reference}`}{r.memo && ` · ${r.memo}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{Number(r.debit) ? formatCurrency(r.debit) : ""}</TableCell>
                  <TableCell className="text-right">{Number(r.credit) ? formatCurrency(r.credit) : ""}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.balance)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={3}>Closing balance{data.truncated && " (first 5,000 lines shown)"}</TableCell>
                <TableCell className="text-right">{formatCurrency(data.totalDebit)}</TableCell>
                <TableCell className="text-right">{formatCurrency(data.totalCredit)}</TableCell>
                <TableCell className="text-right">{formatCurrency(data.closingBalance)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

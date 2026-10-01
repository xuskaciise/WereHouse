"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/utils"
import { CompanyHeader } from "@/components/company-header"
import { ACCOUNT_TYPES, TYPE_LABEL } from "@/lib/account-labels"
import { downloadCsv, downloadXlsx, moneyCell } from "@/lib/export-file"

// Trial balance: net debit or credit per account for the period; totals must be equal.
export default function TrialBalancePage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [data, setData] = useState<any | null>(null)

  useEffect(() => {
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    fetch(`/api/accounts/trial-balance?${qs}`).then(async (r) => r.ok && setData(await r.json()))
  }, [from, to])

  const rows = () => [
    ["Code", "Account", "Type", "Debit", "Credit"],
    ...(data?.lines ?? []).map((l: any) => [l.code, l.name, TYPE_LABEL[l.type], moneyCell(l.debit), moneyCell(l.credit)]),
    ["", "Total", "", moneyCell(data?.totalDebit), moneyCell(data?.totalCredit)],
  ]
  const period = `${from || "start"}_${to || "today"}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Button asChild variant="ghost" className="-ml-4"><Link href="/accounts"><ArrowLeft className="mr-2 h-4 w-4" /> Chart of accounts</Link></Button>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!data} onClick={() => downloadCsv(`trial_balance_${period}.csv`, rows())}><Download className="mr-2 h-4 w-4" /> CSV</Button>
          <Button variant="outline" disabled={!data} onClick={() => downloadXlsx(`trial_balance_${period}.xlsx`, [{ name: "Trial balance", rows: rows() }])}><FileSpreadsheet className="mr-2 h-4 w-4" /> Excel</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <CompanyHeader align="left" className="hidden print:flex" />
              <div>
                <CardTitle className="text-2xl">Trial balance</CardTitle>
                <CardDescription>{from || to ? `${from || "start"} to ${to || "today"}` : "All periods"}</CardDescription>
              </div>
            </div>
            <div className="flex gap-2 print:hidden">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          {data && (
            <div className={`flex items-center gap-2 text-sm ${data.balanced ? "text-green-700" : "text-destructive"}`}>
              {data.balanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {data.balanced ? "Balanced: total debits equal total credits." : "NOT balanced - contact the administrator."}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ACCOUNT_TYPES.flatMap((type) => {
                const lines = (data?.lines ?? []).filter((l: any) => l.type === type)
                if (lines.length === 0) return []
                return [
                  <TableRow key={type} className="bg-muted/40"><TableCell colSpan={4} className="font-semibold">{TYPE_LABEL[type]}s</TableCell></TableRow>,
                  ...lines.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono">{l.code}</TableCell>
                      <TableCell><Link href={`/accounts/${l.id}`} className="hover:underline">{l.name}</Link></TableCell>
                      <TableCell className="text-right">{Number(l.debit) ? formatCurrency(l.debit) : ""}</TableCell>
                      <TableCell className="text-right">{Number(l.credit) ? formatCurrency(l.credit) : ""}</TableCell>
                    </TableRow>
                  )),
                ]
              })}
              <TableRow className="border-t-2 font-bold">
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell className="text-right">{formatCurrency(data?.totalDebit)}</TableCell>
                <TableCell className="text-right">{formatCurrency(data?.totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

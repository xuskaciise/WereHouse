"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/utils"
import { GROUP_LABEL, TYPE_LABEL } from "@/lib/account-labels"

// Ledger: pick an account to see its lines and running balance.
export default function LedgerPickerPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [q, setQ] = useState("")
  useEffect(() => {
    fetch("/api/accounts").then(async (r) => r.ok && setAccounts(await r.json()))
  }, [])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return accounts.filter((a) => !n || a.code.includes(n) || a.name.toLowerCase().includes(n))
  }, [accounts, q])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ledger</h1>
        <p className="text-muted-foreground">Choose an account to see every line with its running balance</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Accounts</CardTitle>
              <CardDescription>{shown.length} account(s)</CardDescription>
            </div>
            <Input className="max-w-xs" placeholder="Search code or name" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((a) => (
                <TableRow key={a.id} className="cursor-pointer">
                  <TableCell className="font-mono">{a.code}</TableCell>
                  <TableCell><Link href={`/accounts/${a.id}`} className="font-medium hover:underline">{a.name}</Link></TableCell>
                  <TableCell className="text-muted-foreground">{TYPE_LABEL[a.type]} · {GROUP_LABEL[a.group]}</TableCell>
                  <TableCell className="text-right">{formatCurrency(a.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

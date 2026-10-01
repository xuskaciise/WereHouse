"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { PaginationControls } from "@/components/ui/pagination-controls"

// Shared list building blocks: server-side paginated + searchable lists
// (the APIs return X-Total-Count), a search box and empty states with the
// next action.

export const PAGE_SIZE = 25

/**
 * Fetches `url` with ?page, ?pageSize, ?q and the given filters (empty ones
 * left out); resets to page 1 when the search or a filter changes.
 */
export function usePagedList<T = any>(url: string | null, filters: Record<string, string | undefined> = {}, { pageSize = PAGE_SIZE } = {}) {
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const filterKey = JSON.stringify(filters)
  const request = useRef(0)

  const load = useCallback(async () => {
    const id = ++request.current
    if (!url) {
      setLoading(false)
      return
    }
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (q.trim()) params.set("q", q.trim())
    for (const [k, v] of Object.entries(JSON.parse(filterKey) as Record<string, string | undefined>)) if (v) params.set(k, v)
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}${params}`)
      const data = await res.json().catch(() => [])
      if (id !== request.current) return
      if (!res.ok) throw new Error(data?.error || "Failed to load")
      setRows(data)
      setTotal(Number(res.headers.get("X-Total-Count") ?? data.length))
      setError("")
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [url, page, pageSize, q, filterKey])

  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  // A new search / filter starts on page 1.
  useEffect(() => setPage(1), [q, filterKey])

  return { rows, total, page, setPage, pageSize, q, setQ, loading, error, reload: load }
}

export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-8" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function ListPagination({ list }: { list: { page: number; pageSize: number; total: number; setPage: (p: number) => void } }) {
  if (list.total <= list.pageSize) return null
  return <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
}

/** Table row for loading / error / empty states, with the next action when empty. */
export function ListStateRow({
  colSpan,
  loading,
  error,
  empty,
  searching,
  emptyText,
  action,
}: {
  colSpan: number
  loading: boolean
  error?: string
  empty: boolean
  searching?: boolean
  emptyText: string
  action?: { label: string; href?: string; onClick?: () => void } | null
}) {
  if (!loading && !error && !empty) return null
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
        {loading ? (
          "Loading..."
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : searching ? (
          "Nothing matches your search or filters."
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span>{emptyText}</span>
            {action &&
              (action.href ? (
                <Button asChild size="sm"><Link href={action.href}>{action.label}</Link></Button>
              ) : (
                <Button size="sm" onClick={action.onClick}>{action.label}</Button>
              ))}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

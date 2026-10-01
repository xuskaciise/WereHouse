"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useCurrentUser } from "@/components/providers/current-user-provider"
import { visibleSections } from "@/lib/navigation"

// Global search (Ctrl+K / Cmd+K): pages of the menu, and on the server
// products, customers, suppliers and document numbers the user may see.
export function GlobalSearch() {
  const router = useRouter()
  const user = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<{ type: string; label: string; sub?: string; href: string }[]>([])
  const [loading, setLoading] = useState(false)
  const pages = useMemo(() => visibleSections(user.permissions).flatMap((s) => s.items), [user.permissions])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`).catch(() => null)
      setHits(res?.ok ? await res.json() : [])
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  const go = (href: string) => {
    setOpen(false)
    setQ("")
    router.push(href)
  }
  const needle = q.trim().toLowerCase()
  const pageHits = needle ? pages.filter((p) => p.label.toLowerCase().includes(needle)).slice(0, 6) : pages.slice(0, 8)
  const groups = hits.reduce<Record<string, typeof hits>>((acc, h) => ((acc[h.type] ??= []).push(h), acc), {})

  return (
    <>
      <Button variant="outline" className="h-9 w-full max-w-md justify-start gap-2 text-muted-foreground" onClick={() => setOpen(true)}>
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate text-left">Search products, customers, orders…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
            <CommandInput placeholder="Product, SKU, customer, supplier, SO-/PO-/TR-/SR-/PR-/JE- number…" value={q} onValueChange={setQ} />
            <CommandList className="max-h-[60vh]">
              <CommandEmpty>{loading ? "Searching…" : q.trim().length < 2 ? "Type at least 2 characters." : "Nothing found."}</CommandEmpty>
              {pageHits.length > 0 && (
                <CommandGroup heading="Pages">
                  {pageHits.map((p) => (
                    <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                      {p.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {Object.entries(groups).map(([type, rows]) => (
                <CommandGroup key={type} heading={type}>
                  {rows.map((h) => (
                    <CommandItem key={`${type}-${h.href}-${h.label}`} value={`${type}-${h.href}-${h.label}`} onSelect={() => go(h.href)}>
                      <span className="font-medium">{h.label}</span>
                      {h.sub && <span className="ml-2 truncate text-xs text-muted-foreground">{h.sub}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}

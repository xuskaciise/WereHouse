"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { useCurrentUser } from "@/components/providers/current-user-provider"
import { type Module, can } from "@/lib/permission-rules"

export interface SectionTab {
  label: string
  href: string
  /** Any one of these modules (view) shows the tab. */
  modules: Module[]
  /** Match also on ?tab=... (for tabs inside one page). */
  tabParam?: string
}

/** Tab links of a hub (Settings, Reports), filtered by permission. */
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const { permissions } = useCurrentUser()
  const visible = tabs.filter((t) => t.modules.some((m) => can(permissions, m, "view")))
  const active = (t: SectionTab) => {
    const [path] = t.href.split("?")
    if (t.tabParam) return pathname === path && (params.get("tab") ?? visible.find((v) => v.tabParam && v.href.split("?")[0] === path)?.tabParam) === t.tabParam
    return pathname === path
  }
  if (visible.length < 2) return null
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b pb-px print:hidden" aria-label="Sections">
      {visible.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors",
            active(t) ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

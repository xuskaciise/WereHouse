"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { useCurrentUser } from "@/components/providers/current-user-provider"
import { NAV_SECTIONS, SEGMENT_LABELS, activeItem, canSee } from "@/lib/navigation"

// Section > Page > Sub-page, from the menu config; ids show as "Details".
export function Breadcrumbs() {
  const pathname = usePathname()
  const params = useSearchParams()
  const { permissions } = useCurrentUser()
  const search = params.toString() ? `?${params.toString()}` : ""
  const item = activeItem(pathname, search, NAV_SECTIONS)
  if (!item || pathname === "/dashboard") return null
  const section = NAV_SECTIONS.find((s) => s.items.includes(item))
  const base = item.href.split("?")[0]
  const rest = pathname.slice(base.length).split("/").filter(Boolean)
  const crumbs: { label: string; href?: string }[] = []
  if (section?.label) crumbs.push({ label: section.label })
  crumbs.push({ label: item.label, href: canSee(permissions, item) && rest.length ? item.href : undefined })
  let href = base
  rest.forEach((segment, index) => {
    href += `/${segment}`
    const last = index === rest.length - 1
    const label = SEGMENT_LABELS[segment] ?? (/^[a-z0-9]{20,}$/i.test(segment) ? "Details" : decodeURIComponent(segment))
    crumbs.push({ label, href: last ? undefined : href })
  })
  if (params.get("mode") === "sell" && pathname === "/sales/new") crumbs.splice(crumbs.length - 1, 1, { label: "Sell now" })

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted-foreground print:hidden">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
          {c.href ? (
            <Link href={c.href} className="hover:text-foreground">{c.label}</Link>
          ) : (
            <span className={i === crumbs.length - 1 ? "font-medium text-foreground" : ""}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

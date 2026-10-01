"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  Boxes,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileBarChart,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Package,
  Receipt,
  Scale,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Undo2,
  UserCog,
  Users,
  Warehouse,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrentUser } from "@/components/providers/current-user-provider"
import { ROLE_LABELS } from "@/lib/permission-rules"
import { type NavSection, activeItem, visibleSections } from "@/lib/navigation"
import { useCompany } from "@/components/company-header"
import { useAttention } from "@/components/layout/use-attention"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  sell: Store,
  cart: ShoppingCart,
  calendar: CalendarClock,
  undo: Undo2,
  users: Users,
  payments: CreditCard,
  bag: ShoppingBag,
  truck: Truck,
  package: Package,
  tags: Tags,
  boxes: Boxes,
  alert: AlertTriangle,
  warehouse: Warehouse,
  transfer: ArrowLeftRight,
  trend: TrendingUp,
  expense: Receipt,
  landmark: Landmark,
  book: BookOpen,
  ledger: FileSpreadsheet,
  scale: Scale,
  reports: FileBarChart,
  userCog: UserCog,
  shield: ShieldCheck,
  settings: Settings,
}

const STORAGE_KEY = "nav-collapsed-sections"

/** Menu grouped by business area; sections collapse and remember their state. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const user = useCurrentUser()
  const company = useCompany()
  const attention = useAttention()
  const sections = useMemo<NavSection[]>(() => visibleSections(user.permissions), [user.permissions])
  const search = params.toString() ? `?${params.toString()}` : ""
  const active = activeItem(pathname, search, sections)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      setCollapsed(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"))
    } catch {
      setCollapsed({})
    }
  }, [])
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: state only for this page
      }
      return next
    })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b px-5">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={company?.logoUrl ?? "/siu_logo.png"} alt="Logo" className="h-full w-full object-contain" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{company?.name ?? "Siu Warehouse"}</span>
          <span className="text-xs text-muted-foreground">Inventory System</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3" aria-label="Main">
        {sections.map((section) => {
          // A collapsed section still opens when it holds the current page.
          const isCollapsed = !!section.label && !!collapsed[section.key] && !(active && section.items.includes(active))
          return (
            <div key={section.key} className="mb-3">
              {section.label && (
                <button
                  type="button"
                  onClick={() => toggle(section.key)}
                  className="mb-1 flex w-full items-center justify-between rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 hover:text-foreground"
                  aria-expanded={!isCollapsed}
                >
                  {section.label}
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              )}
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = ICONS[item.icon] ?? Package
                    const isActive = item === active
                    const count = item.badge ? attention[item.badge] ?? 0 : 0
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {count > 0 && (
                          <span
                            className={cn(
                              "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold",
                              isActive ? "bg-primary-foreground text-primary" : "bg-destructive text-destructive-foreground"
                            )}
                            title="Needs attention"
                          >
                            {count > 99 ? "99+" : count}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="border-t p-4">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{user.username.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{user.name || user.username}</span>
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Desktop sidebar (on phones the same menu opens as a drawer from the navbar). */
export function Sidebar() {
  return (
    <aside className="hidden h-screen w-64 shrink-0 border-r bg-card md:block print:hidden">
      <SidebarContent />
    </aside>
  )
}

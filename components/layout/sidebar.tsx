"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ShoppingBag,
  Warehouse,
  TrendingUp,
  FileText,
  CreditCard,
  DollarSign,
  Settings,
  AlertTriangle,
  Users,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
  children?: NavItem[]
}

interface NavSection {
  title: string
  items: NavItem[]
}

const navigationSections: NavSection[] = [
  {
    title: "Core",
    items: [{ name: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Master Data",
    items: [
      { name: "Warehouses", href: "/warehouses", icon: Warehouse },
      { name: "Categories", href: "/categories", icon: FileText },
      { name: "Products", href: "/products", icon: Package },
      { name: "Suppliers", href: "/suppliers", icon: ShoppingBag },
      { name: "Customers", href: "/customers", icon: ShoppingCart },
    ],
  },
  {
    title: "Procurement (Inbound)",
    items: [
      { name: "Purchases", href: "/purchases", icon: ShoppingBag },
      { name: "Stock (In-hand)", href: "/inventory", icon: Package },
    ],
  },
  {
    title: "Inventory Control",
    items: [
      { name: "Stock Movements", href: "/inventory/movements", icon: TrendingUp },
      { name: "Low Stock Alerts", href: "/inventory/low-stock", icon: AlertTriangle },
      { name: "Expenses", href: "/expenses", icon: DollarSign },
    ],
  },
  {
    title: "Sales & Finance",
    items: [
      { name: "Sales", href: "/sales", icon: ShoppingCart },
      { name: "Payments", href: "/payments", icon: CreditCard },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Reports", href: "/reports", icon: FileText },
      { name: "Users", href: "/users", icon: Users, adminOnly: true },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [user, setUser] = useState<{ username: string; role: string } | null>(null)
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (typeof window !== "undefined") {
      const userData = localStorage.getItem("user") || sessionStorage.getItem("user")
      if (userData) {
        setUser(JSON.parse(userData))
      }
    }
  }, [])

  // Initialize open menus based on active routes
  useEffect(() => {
    const initialOpen: Record<string, boolean> = {}
    navigationSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.children && item.children.length > 0) {
          const hasActiveChild = item.children.some((child) => {
            return pathname === child.href
          })
          const isParentActive = pathname === item.href
          initialOpen[item.name] = hasActiveChild || isParentActive
        }
      })
    })
    setOpenMenus(initialOpen)
  }, [pathname])

  const getUserInitials = () => {
    if (!user) return "U"
    return user.username.substring(0, 2).toUpperCase()
  }

  const getUserDisplayName = () => {
    if (!user) return "User"
    return user.username.charAt(0).toUpperCase() + user.username.slice(1)
  }

  const getRoleDisplayName = () => {
    if (!user) return "User Role"
    return user.role.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())
  }

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border bg-white">
          <Image src="/siu-logo.png" alt="SIU Logo" width={40} height={40} className="h-full w-full object-cover" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Siu Warehouse</span>
          <span className="text-xs text-muted-foreground">Inventory System</span>
        </div>
      </div>

      <nav className="flex-1 p-4 overflow-y-auto">
        {navigationSections.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                // Hide admin-only items if user is not admin
                if (item.adminOnly && user?.role !== "ADMIN") {
                  return null
                }

                // Check if any child route is active (more precise matching)
                // First check for exact matches, then check for path prefixes
                const hasActiveChild = item.children?.some((child) => {
                  return pathname === child.href
                })

                // Check if parent route is active (but not if a child matches exactly or has a prefix match)
                const exactChildMatch = item.children?.some((child) => {
                  return pathname === child.href
                })
                const isParentActive = !exactChildMatch && pathname === item.href

                // If item has children, render as collapsible
                if (item.children && item.children.length > 0) {
                  const isOpen = openMenus[item.name] ?? false

                  return (
                    <Collapsible
                      key={item.name}
                      open={isOpen}
                      onOpenChange={(open) => {
                        setOpenMenus((prev) => ({ ...prev, [item.name]: open }))
                      }}
                      className="w-full"
                    >
                      <CollapsibleTrigger
                        className={cn(
                          "w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          isParentActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <item.icon className="h-5 w-5" />
                          {item.name}
                        </div>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pl-4 space-y-1 mt-1">
                        {item.children.map((child) => {
                          // More precise child active detection
                          // Find the most specific (longest) matching child first
                          const allChildren = item.children || []
                          const matchingChildren = allChildren.filter((c) => {
                            return pathname === c.href
                          })

                          // Sort by href length (longest first) to prioritize more specific matches
                          matchingChildren.sort((a, b) => b.href.length - a.href.length)

                          // Only mark as active if this child is the most specific match
                          const isChildActive = matchingChildren.length > 0 && matchingChildren[0].href === child.href

                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                isChildActive
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                              )}
                            >
                              <child.icon className="h-4 w-4" />
                              {child.name}
                            </Link>
                          )
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  )
                }

                // Regular navigation item without children
                const isActive = pathname === item.href

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.name}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-4">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{getUserInitials()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{getUserDisplayName()}</span>
            <span className="text-xs text-muted-foreground">{getRoleDisplayName()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

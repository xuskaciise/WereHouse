import { type Module, type PermissionMap, can, canOpenPage } from "@/lib/permission-rules"

// Menu of the app, grouped by business area. One source for the sidebar,
// the breadcrumbs and the "+ New" menu. An item is shown when the user may
// open its page (PAGE_MODULES) and, if set, has one of `modules` (view).

export type BadgeKey = "lowStock" | "expiredReservations" | "unpaidCosts"

export interface NavItem {
  label: string
  href: string
  icon: string
  /** Any of these modules (view) is needed besides the page access. */
  modules?: Module[]
  badge?: BadgeKey
}

export interface NavSection {
  key: string
  label: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  { key: "home", label: "", items: [{ label: "Dashboard", href: "/dashboard", icon: "dashboard" }] },
  {
    key: "sales",
    label: "Sales",
    items: [
      { label: "Sell now", href: "/sales/new?mode=sell", icon: "sell", modules: ["sales_deliver"] },
      { label: "Sales orders", href: "/sales", icon: "cart" },
      { label: "Reservations", href: "/sales/reservations", icon: "calendar", badge: "expiredReservations" },
      { label: "Sales returns", href: "/sales/returns", icon: "undo" },
      { label: "Customers", href: "/customers", icon: "users" },
      { label: "Customer payments", href: "/payments?tab=customers", icon: "payments", modules: ["customer_payments"] },
    ],
  },
  {
    key: "purchasing",
    label: "Purchasing",
    items: [
      { label: "Purchase orders", href: "/purchases", icon: "bag" },
      { label: "Purchase returns", href: "/purchases/returns", icon: "undo" },
      { label: "Suppliers", href: "/suppliers", icon: "truck" },
      { label: "Supplier payments", href: "/payments?tab=suppliers", icon: "payments", modules: ["supplier_payments"], badge: "unpaidCosts" },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    items: [
      { label: "Products", href: "/products", icon: "package" },
      { label: "Categories", href: "/categories", icon: "tags" },
      { label: "Stock", href: "/inventory", icon: "boxes" },
      { label: "Low stock", href: "/inventory/low-stock", icon: "alert", badge: "lowStock" },
      { label: "Warehouses", href: "/warehouses", icon: "warehouse" },
      { label: "Transfers", href: "/transfers", icon: "transfer" },
      { label: "Stock movements", href: "/inventory/movements", icon: "trend" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    items: [
      { label: "Expenses", href: "/expenses", icon: "expense", modules: ["expenses"] },
      { label: "Chart of accounts", href: "/accounts", icon: "landmark" },
      { label: "Journal", href: "/accounts/journal", icon: "book" },
      { label: "Ledger", href: "/accounts/ledger", icon: "ledger" },
      { label: "Trial balance", href: "/accounts/trial-balance", icon: "scale" },
    ],
  },
  { key: "reports", label: "", items: [{ label: "Reports", href: "/reports", icon: "reports" }] },
  {
    key: "admin",
    label: "Administration",
    items: [
      { label: "Users", href: "/users", icon: "userCog" },
      { label: "Roles & Permissions", href: "/roles", icon: "shield" },
      { label: "Settings", href: "/settings", icon: "settings" },
    ],
  },
]

export function canSee(permissions: PermissionMap | null | undefined, item: NavItem): boolean {
  const path = item.href.split("?")[0]
  if (!canOpenPage(permissions, path)) return false
  return !item.modules || item.modules.some((m) => can(permissions, m, "view"))
}

/** The menu sections with only the items the user may open (empty sections dropped). */
export function visibleSections(permissions: PermissionMap | null | undefined): NavSection[] {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => canSee(permissions, i)) })).filter((s) => s.items.length > 0)
}

/** Menu item of the current page: the longest matching href (query ignored). */
export function activeItem(pathname: string, search: string, sections: NavSection[]): NavItem | undefined {
  const all = sections.flatMap((s) => s.items)
  const exact = all.find((i) => i.href === `${pathname}${search}`)
  if (exact) return exact
  return all
    .filter((i) => {
      const path = i.href.split("?")[0]
      return !i.href.includes("?") && (pathname === path || pathname.startsWith(path + "/"))
    })
    .sort((a, b) => b.href.length - a.href.length)[0]
}

/** "+ New" menu: [label, href, module, action]. */
export const QUICK_ACTIONS: { label: string; href: string; module: Module; action: "create" }[] = [
  { label: "Sell now", href: "/sales/new?mode=sell", module: "sales_deliver", action: "create" },
  { label: "Sales order", href: "/sales/new", module: "sales", action: "create" },
  { label: "Purchase order", href: "/purchases/new", module: "purchases", action: "create" },
  { label: "Stock transfer", href: "/transfers/new", module: "stock_transfers", action: "create" },
  { label: "Receive customer payment", href: "/payments?tab=customers&new=1", module: "customer_payments", action: "create" },
  { label: "Pay supplier", href: "/payments?tab=suppliers&new=1", module: "supplier_payments", action: "create" },
  { label: "Expense", href: "/expenses?new=1", module: "expenses", action: "create" },
  { label: "Product", href: "/products?new=1", module: "products", action: "create" },
  { label: "Customer", href: "/customers?new=1", module: "customers", action: "create" },
  { label: "Supplier", href: "/suppliers?new=1", module: "suppliers", action: "create" },
]

/** Breadcrumb labels for path segments not in the menu. */
export const SEGMENT_LABELS: Record<string, string> = {
  new: "New",
  returns: "Returns",
  reservations: "Reservations",
  movements: "Stock movements",
  "low-stock": "Low stock",
  journal: "Journal",
  ledger: "Ledger",
  "trial-balance": "Trial balance",
  expenses: "Expenses",
  "profit-loss": "Profit & Loss",
  stock: "Stock",
  financial: "Financial & tax",
  "payment-methods": "Payment methods",
  inventory: "Stock & reservations",
  "landed-cost-types": "Landed cost types",
  "expense-categories": "Expense categories",
  "landed-costs": "Landed costs",
}

import type { Role } from "@prisma/client"

// Central permission model, shared by the server (lib/permissions.ts) and the
// UI (sidebar, page guards, buttons). The server is the authority: every API
// route checks the same map; the UI only hides what would be refused.
//
// A role has, per module: view / create / edit / delete, a scope (ALL =
// company-wide data, OWN = only records the user created) and, for
// sales_discount, a maximum total discount in % (null = no limit).
// ADMIN is not stored: it always has everything and cannot be locked out.

export const MODULES = [
  "dashboard",
  "warehouses",
  "categories",
  "products",
  "suppliers",
  "purchases",
  "purchase_receive",
  "stock",
  "stock_movements",
  "low_stock",
  "customers",
  "sales",
  "sales_discount",
  "customer_payments",
  "supplier_payments",
  "expenses",
  "expense_categories",
  "reports_stock",
  "reports_sales",
  "reports_finance",
  "users",
  "settings",
  "roles",
] as const
export type Module = (typeof MODULES)[number]

export const ACTIONS = ["view", "create", "edit", "delete"] as const
export type Action = (typeof ACTIONS)[number]

export type Scope = "ALL" | "OWN"

export interface ModulePermission {
  view: boolean
  create: boolean
  edit: boolean
  delete: boolean
  scope: Scope
  /** sales_discount only: max total discount %, null = no limit. */
  discountLimit: number | null
}

export type PermissionMap = Record<Module, ModulePermission>

/** Roles whose permissions are stored and editable (ADMIN is fixed). */
export const EDITABLE_ROLES = ["WAREHOUSE_MANAGER", "SALES_MANAGER", "SALES_OFFICER", "ACCOUNTANT", "STUDENT"] as const
export type EditableRole = (typeof EDITABLE_ROLES)[number]

/** Modules that stay ADMIN-only (granting them would allow privilege escalation). */
export const ADMIN_ONLY_MODULES: readonly Module[] = ["users", "roles"]

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  warehouses: "Warehouses",
  categories: "Categories",
  products: "Products",
  suppliers: "Suppliers",
  purchases: "Purchases",
  purchase_receive: "Purchase receive (edit = over-receive / close remaining)",
  stock: "Stock",
  stock_movements: "Stock movements",
  low_stock: "Low stock alerts",
  customers: "Customers",
  sales: "Sales",
  sales_discount: "Sales discounts (create = may give discounts)",
  customer_payments: "Customer payments",
  supplier_payments: "Supplier payments",
  expenses: "Expenses",
  expense_categories: "Expense categories",
  reports_stock: "Reports: stock & purchases",
  reports_sales: "Reports: sales",
  reports_finance: "Reports: payments & finance",
  users: "Users",
  settings: "Settings",
  roles: "Roles & permissions",
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  WAREHOUSE_MANAGER: "Warehouse Manager",
  SALES_MANAGER: "Sales Manager",
  SALES_OFFICER: "Sales Officer",
  ACCOUNTANT: "Accountant",
  STUDENT: "Student",
}

// Templates carry no scope: build() applies the role's default scope unless
// an entry sets one explicitly.
type Grant = Partial<ModulePermission>
const NONE: Grant = { view: false, create: false, edit: false, delete: false }
const FULL: Grant = { view: true, create: true, edit: true, delete: true }
const VIEW: Grant = { view: true }

function build(entries: Partial<Record<Module, Grant>>, scope: Scope = "ALL"): PermissionMap {
  const map = {} as PermissionMap
  for (const mod of MODULES) {
    const entry = entries[mod] ?? {}
    map[mod] = {
      view: !!entry.view,
      create: !!entry.create,
      edit: !!entry.edit,
      delete: !!entry.delete,
      scope: entry.scope ?? scope,
      discountLimit: entry.discountLimit ?? null,
    }
  }
  return map
}

export const ADMIN_PERMISSIONS: PermissionMap = build(Object.fromEntries(MODULES.map((m) => [m, FULL])))

/** Defaults seeded by the role-permissions migration (and used for missing rows). */
export const DEFAULT_PERMISSIONS: Record<EditableRole, PermissionMap> = {
  WAREHOUSE_MANAGER: build({
    dashboard: VIEW,
    warehouses: FULL,
    categories: FULL,
    products: FULL,
    suppliers: FULL,
    purchases: FULL,
    purchase_receive: FULL,
    stock: FULL,
    stock_movements: FULL,
    low_stock: FULL,
    customers: VIEW,
    sales: VIEW,
    reports_stock: VIEW,
  }),
  SALES_MANAGER: build({
    dashboard: VIEW,
    customers: FULL,
    sales: FULL,
    customer_payments: FULL,
    sales_discount: { ...NONE, view: true, create: true, discountLimit: null },
    reports_sales: VIEW,
    products: VIEW,
    categories: VIEW,
    warehouses: VIEW,
    stock: VIEW,
    low_stock: VIEW,
  }),
  SALES_OFFICER: build({
    dashboard: { ...VIEW, scope: "OWN" },
    customers: FULL,
    sales: { ...FULL, scope: "OWN" },
    customer_payments: { ...FULL, scope: "OWN" },
    sales_discount: { ...NONE, view: true, create: true, discountLimit: 10 },
    products: VIEW,
    categories: VIEW,
    stock: VIEW,
    warehouses: VIEW,
  }),
  ACCOUNTANT: build({
    dashboard: VIEW,
    expenses: FULL,
    expense_categories: FULL,
    supplier_payments: FULL,
    customer_payments: FULL,
    reports_finance: VIEW,
    reports_sales: VIEW,
    reports_stock: VIEW,
    suppliers: VIEW,
    customers: VIEW,
    purchases: VIEW,
    sales: VIEW,
    products: VIEW,
    stock: VIEW,
  }),
  // Sandbox: everything on the student's own data, as before this change.
  STUDENT: build(
    {
      dashboard: VIEW,
      warehouses: FULL,
      categories: FULL,
      products: FULL,
      suppliers: FULL,
      purchases: FULL,
      purchase_receive: { ...NONE, view: true, create: true },
      stock: FULL,
      stock_movements: VIEW,
      low_stock: VIEW,
      customers: FULL,
      sales: FULL,
      sales_discount: { ...NONE, view: true, create: true, discountLimit: 10 },
      customer_payments: FULL,
      supplier_payments: FULL,
      expenses: FULL,
      // Categories are shared reference data: students pick them, not manage them.
      expense_categories: { ...VIEW, scope: "ALL" },
      reports_stock: VIEW,
      reports_sales: VIEW,
      reports_finance: VIEW,
      settings: VIEW,
    },
    "OWN"
  ),
}

export function can(permissions: PermissionMap | null | undefined, mod: Module, action: Action = "view"): boolean {
  return !!permissions?.[mod]?.[action]
}

// --- Pages -------------------------------------------------------------------

/** Page path prefix -> module whose "view" permission opens it (longest prefix wins). */
export const PAGE_MODULES: [string, Module | Module[]][] = [
  ["/dashboard", "dashboard"],
  ["/warehouses", "warehouses"],
  ["/categories", "categories"],
  ["/products", "products"],
  ["/suppliers", "suppliers"],
  ["/purchases/new", "purchases"],
  ["/purchases", "purchases"],
  ["/inventory/movements", "stock_movements"],
  ["/inventory/low-stock", "low_stock"],
  ["/inventory", "stock"],
  ["/customers", "customers"],
  ["/sales/new", "sales"],
  ["/sales", "sales"],
  ["/payments", ["customer_payments", "supplier_payments"]],
  ["/expenses", ["expenses", "expense_categories"]],
  ["/reports", ["reports_stock", "reports_sales", "reports_finance"]],
  ["/users", "users"],
  ["/settings", "settings"],
  ["/roles", "roles"],
]

/** Extra action needed on top of "view" for creation pages. */
const PAGE_ACTIONS: Record<string, Action> = { "/purchases/new": "create", "/sales/new": "create" }

export function canOpenPage(permissions: PermissionMap | null | undefined, pathname: string): boolean {
  const entry = PAGE_MODULES.filter(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/")).sort(
    (a, b) => b[0].length - a[0].length
  )[0]
  if (!entry) return true
  const [prefix, modules] = entry
  const action = PAGE_ACTIONS[prefix] ?? "view"
  return (Array.isArray(modules) ? modules : [modules]).some((m) => can(permissions, m, action))
}

// User activity report: the kinds of work a user can have recorded, grouped
// by area. Shared by the API (lib/user-activity.ts) and the report page.

export const ACTIVITY_AREAS = ["sales", "purchases", "payments", "stock", "transfers", "expenses", "master_data", "admin"] as const
export type ActivityArea = (typeof ACTIVITY_AREAS)[number]

export const ACTIVITY_AREA_LABELS: Record<ActivityArea, string> = {
  sales: "Sales",
  purchases: "Purchases",
  payments: "Payments",
  stock: "Stock",
  transfers: "Warehouse transfers",
  expenses: "Expenses",
  master_data: "Master data",
  admin: "Admin",
}

export const ACTIVITY_KINDS = {
  sales_order: { area: "sales", label: "Sales order" },
  sales_delivery: { area: "sales", label: "Delivery" },
  sales_return: { area: "sales", label: "Sales return" },
  sales_event: { area: "sales", label: "Sales order update" },
  customer_payment: { area: "payments", label: "Customer payment" },
  supplier_payment: { area: "payments", label: "Supplier payment" },
  purchase_order: { area: "purchases", label: "Purchase order" },
  purchase_receive: { area: "purchases", label: "Goods received" },
  purchase_adjustment: { area: "purchases", label: "Purchase quantity adjustment" },
  purchase_return: { area: "purchases", label: "Purchase return" },
  landed_cost: { area: "purchases", label: "Landed cost" },
  landed_cost_log: { area: "purchases", label: "Landed cost change" },
  stock_movement: { area: "stock", label: "Stock movement" },
  transfer: { area: "transfers", label: "Stock transfer" },
  transfer_receipt: { area: "transfers", label: "Transfer receipt" },
  transfer_event: { area: "transfers", label: "Transfer update" },
  transfer_cost: { area: "transfers", label: "Transfer cost" },
  expense: { area: "expenses", label: "Expense" },
  product: { area: "master_data", label: "Product created" },
  category: { area: "master_data", label: "Category created" },
  customer: { area: "master_data", label: "Customer created" },
  supplier: { area: "master_data", label: "Supplier created" },
  warehouse: { area: "master_data", label: "Warehouse created" },
  permission_change: { area: "admin", label: "Permission change" },
} as const satisfies Record<string, { area: ActivityArea; label: string }>

export type ActivityKind = keyof typeof ACTIVITY_KINDS

export function activityKindLabel(kind: string): string {
  return (ACTIVITY_KINDS as Record<string, { label: string }>)[kind]?.label ?? kind
}

export function activityAreaOf(kind: string): ActivityArea | undefined {
  return (ACTIVITY_KINDS as Record<string, { area: ActivityArea }>)[kind]?.area
}

export function isActivityArea(value: string): value is ActivityArea {
  return (ACTIVITY_AREAS as readonly string[]).includes(value)
}

import { Suspense } from "react"
import { requirePageAccess } from "@/lib/page-access"
import { SectionTabs } from "@/components/layout/section-tabs"

// Settings hub: each tab has its own module (PAGE_MODULES in lib/permission-rules.ts).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/settings")
  return (
    <div className="space-y-6">
      <Suspense>
        <SectionTabs
          tabs={[
            { label: "General", href: "/settings", modules: ["settings"] },
            { label: "Financial & tax", href: "/settings/financial", modules: ["settings"] },
            { label: "Payment methods", href: "/settings/payment-methods", modules: ["settings"] },
            { label: "Stock & reservations", href: "/settings/inventory", modules: ["settings"] },
            { label: "Landed cost types", href: "/settings/landed-cost-types", modules: ["landed_cost_types"] },
            { label: "Expense categories", href: "/settings/expense-categories", modules: ["expense_categories"] },
          ]}
        />
      </Suspense>
      {children}
    </div>
  )
}

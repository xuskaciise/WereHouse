import { Suspense } from "react"
import { requirePageAccess } from "@/lib/page-access"
import { SectionTabs } from "@/components/layout/section-tabs"

// Reports hub: one tab per report, each needing its report permission
// (PAGE_MODULES in lib/permission-rules.ts).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/reports")
  return (
    <div className="space-y-6">
      <Suspense>
        <SectionTabs
          tabs={[
            { label: "Sales", href: "/reports?tab=sales", modules: ["reports_sales"], tabParam: "sales" },
            { label: "Purchases", href: "/reports?tab=purchases", modules: ["reports_stock"], tabParam: "purchases" },
            { label: "Payments", href: "/reports?tab=payments", modules: ["reports_finance"], tabParam: "payments" },
            { label: "Stock", href: "/reports/stock", modules: ["reports_stock"] },
            { label: "Expenses", href: "/reports/expenses", modules: ["reports_finance"] },
            { label: "Profit & Loss", href: "/reports/profit-loss", modules: ["reports_finance"] },
          ]}
        />
      </Suspense>
      {children}
    </div>
  )
}

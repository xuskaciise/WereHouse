import { Suspense } from "react"
import { redirect } from "next/navigation"
import { Breadcrumbs } from "@/components/layout/breadcrumbs"
import { Sidebar } from "@/components/layout/sidebar"
import { Navbar } from "@/components/layout/navbar"
import { CurrentUserProvider } from "@/components/providers/current-user-provider"
import { getCurrentUser } from "@/lib/auth-guard"
import { reasonReferenceLimit } from "@/lib/sales-discounts"
import { prisma } from "@/lib/prisma"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  const discountReasonReferenceLimit = await reasonReferenceLimit(user.permissions.sales_discount.discountLimit)
  const currency = (await prisma.setting.findUnique({ where: { key: "defaultCurrency" } }))?.value ?? "USD"

  return (
    <CurrentUserProvider user={{ ...user, discountReasonReferenceLimit }} currency={currency}>
      <div className="flex h-screen overflow-hidden">
        <Suspense>
          <Sidebar />
        </Suspense>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense>
            <Navbar />
          </Suspense>
          <main className="flex-1 overflow-y-auto bg-muted/50 p-3 sm:p-6 print:bg-white print:p-0">
            <Suspense>
              <Breadcrumbs />
            </Suspense>
            {children}
          </main>
        </div>
      </div>
    </CurrentUserProvider>
  )
}

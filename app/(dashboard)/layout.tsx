import { redirect } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Navbar } from "@/components/layout/navbar"
import { CurrentUserProvider } from "@/components/providers/current-user-provider"
import { getCurrentUser } from "@/lib/auth-guard"
import { reasonReferenceLimit } from "@/lib/sales-discounts"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  const discountReasonReferenceLimit = await reasonReferenceLimit(user.permissions.sales_discount.discountLimit)

  return (
    <CurrentUserProvider user={{ ...user, discountReasonReferenceLimit }}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Navbar />
          <main className="flex-1 overflow-y-auto bg-muted/50 p-6">
            {children}
          </main>
        </div>
      </div>
    </CurrentUserProvider>
  )
}

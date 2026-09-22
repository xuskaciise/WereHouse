import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth-guard"

// User management is ADMIN-only; the API enforces this too.
export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (user.role !== "ADMIN") redirect("/dashboard")
  return <>{children}</>
}

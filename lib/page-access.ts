import { redirect } from "next/navigation"
import { getCurrentUser, type SessionUser } from "@/lib/auth-guard"
import { canOpenPage } from "@/lib/permission-rules"

/**
 * Server-side page guard, called from each dashboard segment's layout.tsx
 * with that segment's path. Uses the same PAGE_MODULES map as the sidebar,
 * so a link is shown exactly when its page opens. Redirects to /login when
 * signed out and to /no-access when the role may not view the page.
 * scripts/check-route-guards.mjs verifies every dashboard page is covered.
 */
export async function requirePageAccess(path: string): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!canOpenPage(user.permissions, path)) redirect("/no-access")
  return user
}

"use client"

import { createContext, useContext } from "react"
import type { Role } from "@prisma/client"
import { type Action, type Module, type PermissionMap, can } from "@/lib/permission-rules"

export interface CurrentUser {
  id: string
  name: string
  username: string
  role: Role
  permissions: PermissionMap
  /** Discount limit a reason is measured against (see lib/sales-discounts.ts). */
  discountReasonReferenceLimit: number
}

const CurrentUserContext = createContext<CurrentUser | null>(null)

// Display-only copy of the server-verified user and permissions, used to hide
// links and buttons. Never used for authorization: every API route and page
// re-checks the same permissions on the server.
export function CurrentUserProvider({
  user,
  children,
}: {
  user: CurrentUser
  children: React.ReactNode
}) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error("useCurrentUser must be used inside the dashboard layout")
  return user
}

/** Whether the current user's role may do `action` in `module` (UI only). */
export function useCan(module: Module, action: Action = "view"): boolean {
  return can(useCurrentUser().permissions, module, action)
}

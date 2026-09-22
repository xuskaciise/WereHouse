"use client"

import { createContext, useContext } from "react"
import type { Role } from "@prisma/client"

export interface CurrentUser {
  id: string
  name: string
  username: string
  role: Role
}

const CurrentUserContext = createContext<CurrentUser | null>(null)

// Display-only copy of the server-verified user. Never used for authorization:
// every API route re-checks the session on the server.
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

import { getCurrentUser, type SessionUser } from "@/lib/auth-guard"

export type RequestUser = SessionUser

export function isAdminRole(role?: string | null): boolean {
  return (role || "").toUpperCase() === "ADMIN"
}

// The user now comes from the signed Auth.js session cookie, never from
// client-supplied headers. The request argument is kept for call-site
// compatibility.
export async function getRequestUser(_request?: Request): Promise<RequestUser | null> {
  return getCurrentUser()
}

export function ownershipWhere(user: RequestUser | null, field = "userId") {
  if (!user || isAdminRole(user.role)) return {}
  return { [field]: user.id }
}

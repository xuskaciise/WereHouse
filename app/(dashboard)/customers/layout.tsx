import { requirePageAccess } from "@/lib/page-access"

// Page guard: see PAGE_MODULES in lib/permission-rules.ts.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/customers")
  return <>{children}</>
}

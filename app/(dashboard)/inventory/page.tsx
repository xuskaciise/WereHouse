import { requirePageAccess } from "@/lib/page-access"
import InventoryClient from "./inventory-client"

// /inventory has no guarding layout (its subpages need other modules), so the
// index page checks its own access (PAGE_MODULES in lib/permission-rules.ts).
export default async function InventoryPage() {
  await requirePageAccess("/inventory")
  return <InventoryClient />
}

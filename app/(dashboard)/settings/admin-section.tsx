import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth-guard"
import { can } from "@/lib/permission-rules"
import { SettingsForm, type SettingsSection } from "./settings-form"

// A Settings tab that belongs to the settings module (ADMIN). Roles that only
// manage landed cost types or expense categories are sent to their tab.
export async function AdminSettingsSection({ section }: { section: SettingsSection }) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!can(user.permissions, "settings", "view")) {
    redirect(can(user.permissions, "landed_cost_types", "view") ? "/settings/landed-cost-types" : "/settings/expense-categories")
  }
  return <SettingsForm section={section} />
}

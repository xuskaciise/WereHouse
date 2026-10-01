import { requirePageAccess } from "@/lib/page-access"
import { LandedCostTypesView } from "../../landed-cost-types/landed-cost-types-view"
import { LandedCostTemplatesCard } from "./templates-card"

export default async function Page() {
  await requirePageAccess("/settings/landed-cost-types")
  return (
    <div className="space-y-6">
      <LandedCostTypesView />
      <LandedCostTemplatesCard />
    </div>
  )
}

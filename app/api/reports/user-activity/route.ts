import { json, withAuth } from "@/lib/api"
import { activityUserOptions, activityWarehouseOptions, parseUserActivityFilters, userActivityReport } from "@/lib/user-activity"

// User activity report (admin only, like user management): everything one
// user recorded. ?options=1 returns only the users and warehouses for the
// filters; otherwise see parseUserActivityFilters for the parameters.
export const GET = withAuth(async (request) => {
  const params = new URL(request.url).searchParams
  if (params.get("options")) {
    const [users, warehouses] = await Promise.all([activityUserOptions(), activityWarehouseOptions()])
    return json({ users, warehouses })
  }
  return json(await userActivityReport(parseUserActivityFilters(params)))
}, { permission: ["users", "view"] })

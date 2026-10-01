import { json, readJson, withAuth } from "@/lib/api"
import { createTemplate, listTemplates } from "@/lib/landed-cost-templates"

// Landed cost templates: ?active=true for the ones that can be applied.
export const GET = withAuth(async (request) => {
  return json(await listTemplates({ activeOnly: new URL(request.url).searchParams.get("active") === "true" }))
}, { permission: [["landed_costs", "view"], ["landed_cost_types", "view"]] })

// Managed with the cost types (landed_cost_types:create).
export const POST = withAuth(async (request, { user }) => json(await createTemplate(user, await readJson(request)), { status: 201 }), {
  permission: ["landed_cost_types", "create"],
})

import { json, readJson, withAuth } from "@/lib/api"
import { deleteTemplate, updateTemplate } from "@/lib/landed-cost-templates"

// Rename, (de)activate or replace the lines of a template.
export const PATCH = withAuth<{ id: string }>(async (request, { params }) => json(await updateTemplate(params.id, await readJson(request))), {
  permission: ["landed_cost_types", "edit"],
})

// Templates are only presets: deleting one never touches costs already applied.
export const DELETE = withAuth<{ id: string }>(async (_request, { params }) => {
  await deleteTemplate(params.id)
  return json({ success: true })
}, { permission: ["landed_cost_types", "delete"] })

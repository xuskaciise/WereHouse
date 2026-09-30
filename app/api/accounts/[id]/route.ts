import { json, readJson, withAuth } from "@/lib/api"
import { deleteAccount, updateAccount } from "@/lib/accounts"

// Rename / recode / (de)activate; system accounts keep their type and stay active.
export const PATCH = withAuth<{ id: string }>(async (request, { params }) => json(await updateAccount(params.id, await readJson(request))), {
  permission: ["accounting", "edit"],
})

// Only unused non-system accounts can be deleted.
export const DELETE = withAuth<{ id: string }>(async (_request, { params }) => {
  await deleteAccount(params.id)
  return json({ success: true })
}, { permission: ["accounting", "edit"] })

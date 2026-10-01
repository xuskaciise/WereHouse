import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { previewCostPayment } from "@/lib/cost-payments"

/**
 * How a payment amount would be split over the selected cost lines (FIFO),
 * computed by the same code that saves. Nothing is written.
 * Body: { supplierId, lines, amount? }. Problems: 200 with { error }.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    return json({ ...(await previewCostPayment(user, await readJson(request))), error: null })
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) return json({ error: e.message })
    throw e
  }
}, { permission: ["supplier_payments", "create"] })

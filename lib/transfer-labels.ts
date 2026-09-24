// Display labels for stock transfers (UI only).

export const TRANSFER_STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }
> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  IN_TRANSIT: { label: "In transit", variant: "warning" },
  PARTIALLY_RECEIVED: { label: "Partially received", variant: "default" },
  RECEIVED: { label: "Received", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
}

export const TRANSFER_EVENTS: Record<string, string> = {
  CREATED: "Created",
  DRAFT_UPDATED: "Draft edited",
  DISPATCHED: "Dispatched (stock left the source)",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CLOSED: "Remaining quantity closed",
  CANCELLED: "Cancelled",
  COST_ADDED: "Transfer cost added",
  COST_UPDATED: "Transfer cost changed",
  COST_DELETED: "Transfer cost deleted",
}

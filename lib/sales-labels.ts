// Display labels for sales orders (UI only).

export const SALES_STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" }
> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  CONFIRMED: { label: "Confirmed (reserved)", variant: "warning" },
  PARTIALLY_DELIVERED: { label: "Partially delivered", variant: "default" },
  DELIVERED: { label: "Delivered", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
}

export const SALES_EVENTS: Record<string, string> = {
  CREATED: "Created (draft)",
  EDITED: "Edited",
  CONFIRMED: "Confirmed - stock reserved",
  PARTIALLY_DELIVERED: "Partially delivered",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled - reservation released",
  CLOSED: "Closed - rest released",
  RESERVATION_EXTENDED: "Reservation extended",
  RESERVATION_RELEASED: "Reservation released",
  RETURNED: "Goods returned",
}

export const isOpenSalesStatus = (status: string) => status === "CONFIRMED" || status === "PARTIALLY_DELIVERED"

export const SHELF_LIFE_ERROR =
  "Error: Alaabtan muddada u dhiman waa mid aad u yar (Shelf life must be at least 6 months)."

type ValidateProductDatesInput = {
  productionDate?: string | null
  expiryDate?: string | null
}

function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null
  const parts = value.split("-")
  if (parts.length !== 3) return null
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return date
}

export function validateProductDates(input: ValidateProductDatesInput): string | null {
  const production = parseDateOnly(input.productionDate)
  const expiry = parseDateOnly(input.expiryDate)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (input.productionDate && !production) {
    return "Production date is invalid."
  }

  if (input.expiryDate && !expiry) {
    return "Expiry date is invalid."
  }

  if (production && production.getTime() > today.getTime()) {
    return "Production date cannot be in the future."
  }

  if (production && expiry && expiry.getTime() <= production.getTime()) {
    return "Expiry date must be after production date."
  }

  if (expiry) {
    const msPerDay = 24 * 60 * 60 * 1000
    const diffDays = Math.floor((expiry.getTime() - today.getTime()) / msPerDay)
    if (diffDays < 180) {
      return SHELF_LIFE_ERROR
    }
  }

  return null
}


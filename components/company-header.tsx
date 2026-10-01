"use client"

import { useEffect, useState } from "react"

// Company details from Settings for printed documents (invoice, notes).

export interface CompanyProfile {
  name: string
  address: string
  phone: string
  email: string
  website: string
  paymentTerms: string
  logoUrl: string
  walkInCustomerId?: string
}

let request: Promise<CompanyProfile | null> | null = null
export function useCompany(): CompanyProfile | null {
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  useEffect(() => {
    request ??= fetch("/api/company").then((r) => (r.ok ? r.json() : null)).catch(() => null)
    request.then(setCompany)
  }, [])
  return company
}

/** Logo + name + contact lines (right-aligned block for document headers). */
export function CompanyHeader({ className = "", align = "right" }: { className?: string; align?: "left" | "right" | "center" }) {
  const company = useCompany()
  if (!company) return null
  const text = align === "right" ? "text-right items-end" : align === "center" ? "text-center items-center" : "text-left items-start"
  return (
    <div className={`flex flex-col gap-1 ${text} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={company.logoUrl} alt={company.name} className="h-14 w-auto max-w-[180px] object-contain" />
      <div className="text-sm font-semibold">{company.name}</div>
      {company.address && <div className="whitespace-pre-line text-xs text-muted-foreground">{company.address}</div>}
      {(company.phone || company.email) && (
        <div className="text-xs text-muted-foreground">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>
      )}
    </div>
  )
}

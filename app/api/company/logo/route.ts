import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api"
import { getCompanyLogo } from "@/lib/company"

// The uploaded company logo (Settings), or the default logo.
export const GET = withAuth(async (request) => {
  const logo = await getCompanyLogo()
  if (!logo) return NextResponse.redirect(new URL("/siu_logo.png", request.url))
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: { "Content-Type": logo.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  })
}, { authenticatedOnly: true })

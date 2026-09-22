import { NextResponse } from "next/server"
import { Prisma, type Role } from "@prisma/client"
import { HttpError, requireAuth, requireRole, type SessionUser } from "@/lib/auth-guard"

// Every app/api/**/route.ts handler must be wrapped in withAuth() or
// publicRoute(); scripts/check-route-guards.mjs enforces this in `npm run lint`.

type Params = Record<string, string>

interface RouteContext<P extends Params> {
  params: Promise<P>
}

type AuthedHandler<P extends Params> = (
  request: Request,
  context: { user: SessionUser; params: P }
) => Promise<Response>

export function withAuth<P extends Params = Params>(
  handler: AuthedHandler<P>,
  options: { roles?: Role[] } = {}
) {
  return async (request: Request, context: RouteContext<P>): Promise<Response> => {
    try {
      const user = options.roles?.length ? await requireRole(...options.roles) : await requireAuth()
      const params = ((await context?.params) ?? {}) as P
      return await handler(request, { user, params })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/** Explicitly unauthenticated route (e.g. public sign-up). */
export function publicRoute(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/**
 * Converts any thrown error into a JSON response. Only HttpError messages and
 * a few well-known Prisma errors are shown to the client; everything else is
 * logged server-side and answered with a generic message.
 */
export function errorResponse(error: unknown, fallbackMessage = "Something went wrong. Please try again."): Response {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2025":
        return NextResponse.json({ error: "Record not found" }, { status: 404 })
      case "P2002":
        return NextResponse.json({ error: "A record with these details already exists" }, { status: 409 })
      case "P2003":
        return NextResponse.json(
          { error: "This record is linked to other data and cannot be changed or deleted" },
          { status: 409 }
        )
    }
  }

  console.error(error)
  const body: Record<string, string> = { error: fallbackMessage }
  if (process.env.NODE_ENV !== "production" && error instanceof Error) {
    body.detail = error.message
  }
  return NextResponse.json(body, { status: 500 })
}

export async function readJson<T = any>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, "Invalid JSON body")
  }
}

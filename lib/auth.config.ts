import type { NextAuthConfig } from "next-auth"

// Edge-safe Auth.js config shared by middleware.ts and lib/auth.ts.
// Must not import Prisma or other Node-only modules.

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60 // 8 hours

export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  // Session cookies are always httpOnly + SameSite=Lax; in production they are
  // also Secure and use the __Secure- prefix.
  useSecureCookies: process.env.NODE_ENV === "production",
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id
        token.role = user.role
      }
      return token
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      session.user.role = token.role
      return session
    },
  },
} satisfies NextAuthConfig

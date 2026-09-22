import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { authConfig } from "@/lib/auth.config"
import { verifyPassword } from "@/lib/password"
import { FailureLimiter, getClientIp } from "@/lib/rate-limit"

// The `code` of these errors is exposed to the login page, so it must never
// reveal whether the username or the password was wrong.
class AccountPendingError extends CredentialsSignin {
  code = "pending"
}
class AccountRejectedError extends CredentialsSignin {
  code = "rejected"
}
class TooManyAttemptsError extends CredentialsSignin {
  code = "rate_limited"
}

// 5 failed attempts per (ip, username) within 15 minutes locks that pair for 15 minutes.
const loginFailures = new FailureLimiter(5, 15 * 60_000, 15 * 60_000)

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const username = typeof credentials?.username === "string" ? credentials.username.trim() : ""
        const password = typeof credentials?.password === "string" ? credentials.password : ""
        if (!username || !password || username.length > 100 || password.length > 200) return null

        const limiterKey = `${getClientIp(request.headers)}|${username.toLowerCase()}`
        if (loginFailures.isBlocked(limiterKey)) throw new TooManyAttemptsError()

        const user = await prisma.user.findUnique({
          where: { username },
          select: { id: true, name: true, role: true, status: true, passwordHash: true },
        })

        const passwordOk = await verifyPassword(password, user?.passwordHash)
        if (!user || !passwordOk) {
          loginFailures.recordFailure(limiterKey)
          return null
        }
        loginFailures.reset(limiterKey)

        if (user.status === "PENDING") throw new AccountPendingError()
        if (user.status === "REJECTED") throw new AccountRejectedError()
        if (user.status !== "APPROVED") return null

        return { id: user.id, name: user.name, role: user.role }
      },
    }),
  ],
})

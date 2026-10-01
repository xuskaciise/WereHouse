// Creates / resets two DEV-only smoke-test users (ADMIN and ACCOUNTANT) with a
// random password written to the file given as argument (never printed).
import { writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { hashPassword } from "@/lib/password"
import { assertDevDatabase } from "./helpers"

async function main() {
  assertDevDatabase()
  const password = randomBytes(12).toString("base64url")
  const passwordHash = await hashPassword(password)
  for (const [username, role] of [["smoke_admin", "ADMIN"], ["smoke_accountant", "ACCOUNTANT"]] as const) {
    await prisma.user.upsert({
      where: { username },
      update: { passwordHash, status: "APPROVED", role },
      create: { username, name: username, role, status: "APPROVED", passwordHash },
    })
  }
  writeFileSync(process.argv[2], password)
  console.log("smoke users ready")
}

main().finally(() => prisma.$disconnect())

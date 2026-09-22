import { randomInt } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { hashPassword, validatePassword } from "../lib/password"

// Creates the first ADMIN account. Safe to run repeatedly:
//  - if the user does not exist it is created (APPROVED, bcrypt-hashed password)
//  - if it exists it is (re-)promoted to an APPROVED ADMIN and its password is
//    left untouched
// Configuration (environment or .env):
//  ADMIN_USERNAME  default "admin"
//  ADMIN_PASSWORD  optional; when empty a strong random password is generated
//                  and printed ONCE to this terminal (never written to disk)
// No demo users or sample data are created.

try {
  process.loadEnvFile?.(".env")
} catch {
  // No .env file: rely on the real environment.
}

const prisma = new PrismaClient()

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_=+"

function generatePassword(length = 20): string {
  // Guarantee at least one of each character class, then fill randomly.
  const classes = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_=+"]
  const chars = classes.map((set) => set[randomInt(set.length)])
  while (chars.length < length) chars.push(PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

async function main() {
  const username = (process.env.ADMIN_USERNAME || "admin").trim()
  if (!username) throw new Error("ADMIN_USERNAME must not be empty")

  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ADMIN", status: "APPROVED" },
    })
    console.log(`Admin user "${username}" already exists — ensured role ADMIN / status APPROVED. Password unchanged.`)
    return
  }

  const providedPassword = process.env.ADMIN_PASSWORD
  const password = providedPassword || generatePassword()
  const passwordError = validatePassword(password)
  if (passwordError) throw new Error(`ADMIN_PASSWORD: ${passwordError}`)

  await prisma.user.create({
    data: {
      name: "Administrator",
      username,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      status: "APPROVED",
    },
  })

  console.log(`Created admin user "${username}".`)
  if (!providedPassword) {
    console.log("Generated password (shown only once, store it in a password manager):")
    console.log(`  ${password}`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("Seeding failed:", error instanceof Error ? error.message : error)
    await prisma.$disconnect()
    process.exit(1)
  })

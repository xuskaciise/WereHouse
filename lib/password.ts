import bcrypt from "bcryptjs"

const BCRYPT_COST = 12
export const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 72 // bcrypt ignores bytes beyond 72

let dummyHash: string | null = null

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} bytes long`
  }
  return null
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

/**
 * Compares a password with a bcrypt hash. When no hash is available the
 * password is still compared against a dummy hash so that unknown usernames
 * take the same time as wrong passwords.
 */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    dummyHash ??= await bcrypt.hash("timing-equalizer", BCRYPT_COST)
    await bcrypt.compare(password, dummyHash)
    return false
  }
  return bcrypt.compare(password, hash)
}

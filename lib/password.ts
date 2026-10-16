// Native bcrypt: hashing runs on libuv worker threads instead of blocking the
// event loop (bcryptjs took ~1s of main-thread CPU per login). Produces and
// verifies the same $2a/$2b hashes as bcryptjs.
import { compare as bcryptCompare, hash as bcryptHash } from "@node-rs/bcrypt"

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
  return bcryptHash(password, BCRYPT_COST)
}

/**
 * Compares a password with a bcrypt hash. When no hash is available the
 * password is still compared against a dummy hash so that unknown usernames
 * take the same time as wrong passwords.
 */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    dummyHash ??= await bcryptHash("timing-equalizer", BCRYPT_COST)
    await bcryptCompare(password, dummyHash)
    return false
  }
  return bcryptCompare(password, hash)
}

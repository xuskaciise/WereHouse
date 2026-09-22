// Auth.js endpoints (sign-in, sign-out, session, csrf). Public by design;
// credential checks and login rate limiting live in lib/auth.ts.
import { handlers } from "@/lib/auth"

export const { GET, POST } = handlers

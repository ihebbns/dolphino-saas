import { jwtVerify } from 'jose'

// Kept separate from lib/auth.ts on purpose — that file's getApiKey/signToken
// stay untouched and keep serving the existing single-restaurant login/routes.
// This only verifies the NEW org-owner JWT (claims {oid, name, kind:'org'}),
// same secret/algorithm as signToken() so both are issued by one source of truth.
const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dolphino-secret-change-me'
)

export async function verifyOrgToken(req: Request): Promise<{ oid: number; name: string } | null> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.kind !== 'org' || typeof payload.oid !== 'number') return null
    return { oid: payload.oid, name: String(payload.name || '') }
  } catch {
    return null
  }
}

import { SignJWT, jwtVerify } from 'jose'

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dolphino-secret-change-me'
)

export async function signToken(payload: object): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret)
}

export function getApiKey(req: Request): string {
  return (
    req.headers.get('x-api-key') ||
    new URL(req.url).searchParams.get('key') ||
    ''
  )
}

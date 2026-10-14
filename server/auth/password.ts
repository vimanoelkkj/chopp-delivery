export const PASSWORD_ITERATIONS = 100_000
const PREFIX = `pbkdf2-sha256-hmac-v1$${PASSWORD_ITERATIONS}`
const HASH_PATTERN = /^pbkdf2-sha256-hmac-v1\$100000\$([a-f0-9]{32})\$([a-f0-9]{64})$/
const DUMMY_HASH = `${PREFIX}$${'00'.repeat(16)}$${'00'.repeat(32)}`

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function unhex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
}

export function randomToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

export async function tokenHash(token: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

async function pepperKey(pepper: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/.test(pepper)) throw new Error('Configuração de autenticação inválida')
  return crypto.subtle.importKey('raw', unhex(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function keyedHash(value: string, pepper: string): Promise<string> {
  return hex(
    await crypto.subtle.sign('HMAC', await pepperKey(pepper), new TextEncoder().encode(value)),
  )
}

async function derive(password: string, salt: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: PASSWORD_ITERATIONS },
    key,
    256,
  )
}

/** O MAC posterior protege a derivação contra comprometimento isolado do D1. */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  const mac = await crypto.subtle.sign(
    'HMAC',
    await pepperKey(pepper),
    await derive(password, salt),
  )
  return `${PREFIX}$${salt}$${hex(mac)}`
}

export async function verifyPassword(
  password: string,
  stored: string | null,
  pepper: string,
): Promise<boolean> {
  const match = HASH_PATTERN.exec(stored ?? '')
  const selected = match ?? HASH_PATTERN.exec(DUMMY_HASH)
  if (!selected) throw new Error('Política de senha inválida')
  const valid = await crypto.subtle.verify(
    'HMAC',
    await pepperKey(pepper),
    unhex(selected[2]),
    await derive(password, selected[1]),
  )
  return match !== null && valid
}

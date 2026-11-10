/**
 * Política de senhas administrativas (F2). Fonte única para bootstrap, recuperação e Worker de
 * produção. O login NÃO usa o mínimo: ele aceita 1–128 para não bloquear contas já existentes.
 * Não há regras de composição (maiúscula/símbolo); só tamanho e recusa de senhas triviais.
 */
export const PASSWORD_MIN_CHARS = 8
export const PASSWORD_MAX_CHARS = 128
export const PASSWORD_MAX_BYTES = 512

// Senhas muito comuns com 8+ caracteres, em minúsculas. Lista local e curta de propósito: sem
// dependência nem consulta externa. Quem quiser cobertura maior troca por k-anonymity (HIBP).
const COMMON = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '12345678910',
  '11111111',
  '00000000',
  '87654321',
  '987654321',
  '123123123',
  '12341234',
  '1q2w3e4r',
  '1qaz2wsx',
  'q1w2e3r4',
  'qwertyui',
  'qwertyuiop',
  'qwerty123',
  'qwerty12',
  'asdfghjk',
  'asdfghjkl',
  'zxcvbnm1',
  'abcd1234',
  'abc12345',
  'abcdefgh',
  'abcdefg1',
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'senha123',
  'senha1234',
  'senha12345',
  'minhasenha',
  'senhasenha',
  'mudar123',
  'mudar@123',
  'admin123',
  'admin1234',
  'administrator',
  'adminadmin',
  'administrador',
  'letmein1',
  'welcome1',
  'welcome123',
  'iloveyou',
  'sunshine',
  'football',
  'baseball',
  'superman',
  'trustno1',
  'monkey123',
  'dragon123',
  'master123',
  'login123',
  'brasil123',
  'brasil2024',
  'brasil2025',
  'brasil2026',
  'flamengo',
  'corinthians',
  'palmeiras',
  'chopp123',
  'chopp1234',
  'chopp2026',
  'choppdelivery',
  'delivery123',
  'proprietario',
  'owner123',
  'changeme',
  'change123',
  'testtest',
  'test1234',
  'teste123',
  'teste1234',
])

const hasRun = (value: string): boolean => {
  // Sequências inteiras crescentes/decrescentes de dígitos ou letras ("23456789", "hgfedcba").
  const codes = [...value].map((c) => c.codePointAt(0) ?? 0)
  const step = codes[1] - codes[0]
  return Math.abs(step) === 1 && codes.every((c, i) => i === 0 || c - codes[i - 1] === step)
}

export type PasswordPolicyIssue = 'length' | 'bytes' | 'common' | 'repetitive' | 'username'

/** `null` = aceita. Nunca inclui o valor da senha no retorno. */
export function passwordPolicyIssue(
  username: string,
  password: string,
): PasswordPolicyIssue | null {
  const chars = [...password]
  if (chars.length < PASSWORD_MIN_CHARS || chars.length > PASSWORD_MAX_CHARS) return 'length'
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'bytes'
  const folded = password.normalize('NFKC').toLowerCase()
  if (COMMON.has(folded)) return 'common'
  if (new Set(chars).size === 1 || hasRun(folded)) return 'repetitive'
  if (folded === username.toLowerCase()) return 'username'
  return null
}

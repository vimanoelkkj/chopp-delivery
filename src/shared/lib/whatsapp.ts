/** Aceita 10–11 dígitos (DDD + número, assume Brasil) ou 12–15 dígitos (já com país). */
export function normalizeWhatsAppNumber(raw: string | undefined | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  if (digits.length >= 12 && digits.length <= 15) return digits
  return null
}

/** Monta o link de conversa. Sem número válido não existe link: retorna null. */
export function buildWhatsAppUrl(number: string | null, message?: string): string | null {
  if (!number) return null
  const base = `https://wa.me/${number}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

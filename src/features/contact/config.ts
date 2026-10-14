import { normalizeWhatsAppNumber } from '@/shared/lib/whatsapp'

/** Dados de contato. O que ainda não foi confirmado fica indefinido e aparece como placeholder. */
export const contact = {
  whatsappNumber: normalizeWhatsAppNumber(import.meta.env.VITE_WHATSAPP_NUMBER),
  address: undefined as string | undefined,
  hours: undefined as string | undefined,
  instagram: undefined as string | undefined,
}

export const placeholders = {
  whatsapp: '[NÚMERO]',
  address: '[Endereço]',
  hours: '[Horário de atendimento]',
  instagram: '[Instagram]',
} as const

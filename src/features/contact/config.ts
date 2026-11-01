import { normalizeWhatsAppNumber } from '@/shared/lib/whatsapp'

/** Dados de contato e fallbacks limpos sem colchetes de desenvolvimento (A16). */
export const contact = {
  whatsappNumber: normalizeWhatsAppNumber(import.meta.env.VITE_WHATSAPP_NUMBER),
  address: 'São João del-Rei e Região, MG' as string | undefined,
  hours: undefined as string | undefined,
  instagram: undefined as string | undefined,
}

export const placeholders = {
  whatsapp: '',
  address: 'São João del-Rei e Região, MG',
  hours: 'Atendimento via WhatsApp',
  instagram: '',
} as const

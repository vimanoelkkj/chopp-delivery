import { normalizeWhatsAppNumber } from '@/shared/lib/whatsapp'

/** Dados de contato e fallbacks limpos sem colchetes de desenvolvimento (A16). */
export const contact = {
  whatsappNumber: normalizeWhatsAppNumber(import.meta.env.VITE_WHATSAPP_NUMBER),
  address: 'Belo Horizonte e região' as string | undefined,
  hours: undefined as string | undefined,
  instagram: undefined as string | undefined,
}

export const placeholders = {
  whatsapp: '',
  address: 'Belo Horizonte e região',
  hours: 'Atendimento via WhatsApp',
  instagram: '',
} as const

import { describe, expect, it } from 'vitest'
import { buildWhatsAppUrl, normalizeWhatsAppNumber } from './whatsapp'

describe('normalizeWhatsAppNumber', () => {
  it('mantém números já com país', () => {
    expect(normalizeWhatsAppNumber('5531912345678')).toBe('5531912345678')
  })

  it('remove máscara e adiciona 55 a números nacionais', () => {
    expect(normalizeWhatsAppNumber('(31) 91234-5678')).toBe('5531912345678')
  })

  it('rejeita vazio, indefinido e números curtos', () => {
    expect(normalizeWhatsAppNumber('')).toBeNull()
    expect(normalizeWhatsAppNumber(undefined)).toBeNull()
    expect(normalizeWhatsAppNumber('12345')).toBeNull()
  })
})

describe('buildWhatsAppUrl', () => {
  it('não gera link sem número', () => {
    expect(buildWhatsAppUrl(null, 'Olá')).toBeNull()
  })

  it('codifica a mensagem', () => {
    expect(buildWhatsAppUrl('5531912345678', 'Olá! Pedido:\n1 barril')).toBe(
      'https://wa.me/5531912345678?text=Ol%C3%A1!%20Pedido%3A%0A1%20barril',
    )
  })

  it('omite o parâmetro quando não há mensagem', () => {
    expect(buildWhatsAppUrl('5531912345678')).toBe('https://wa.me/5531912345678')
  })
})

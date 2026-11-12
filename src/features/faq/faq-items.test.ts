import { describe, expect, it } from 'vitest'
import { faqItems } from './faq-items'

describe('faqItems', () => {
  const payment = faqItems.find((item) => item.id === 'pagamento')

  it('mantém a pergunta sobre pagamento', () => {
    expect(payment?.question).toBe('Quais as formas de pagamento?')
  })

  it('informa os quatro meios aprovados e confirma condições antes de concluir o pedido', () => {
    for (const method of ['Pix', 'dinheiro', 'cartão de crédito', 'cartão de débito'])
      expect(payment?.answer).toContain(method)
    expect(payment?.answer).toContain('Eventuais condições ou acréscimos')
    expect(payment?.answer).toContain('antes da conclusão do pedido')
  })

  it('não inventa percentuais, parcelamento, descontos ou isenção de taxas', () => {
    for (const item of faqItems) {
      expect(item.answer).not.toMatch(/%|parcela|desconto|sem taxa|grátis|gratuit/i)
    }
  })

  it('informa frete por bairro e orienta avisar sobre escadas', () => {
    const delivery = faqItems.find((item) => item.id === 'entrega')?.answer
    expect(delivery).toContain('exclusivamente por delivery em Belo Horizonte e região')
    expect(delivery).toContain('frete é calculado conforme o bairro')
    expect(delivery).toContain('confirmado no atendimento pelo WhatsApp')
    expect(faqItems.find((item) => item.id === 'instalacao')?.answer).toContain('escadas')
  })

  it('usa ids únicos', () => {
    expect(new Set(faqItems.map((item) => item.id)).size).toBe(faqItems.length)
  })
})

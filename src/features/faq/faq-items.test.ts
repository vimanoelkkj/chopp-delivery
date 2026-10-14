import { describe, expect, it } from 'vitest'
import { faqItems } from './faq-items'

describe('faqItems', () => {
  const payment = faqItems.find((item) => item.id === 'pagamento')

  it('mantém a pergunta sobre pagamento', () => {
    expect(payment?.question).toBe('Quais as formas de pagamento?')
  })

  it('deixa a resposta de pagamento como pendente de confirmação comercial', () => {
    expect(payment?.answer).toMatch(/^\[.*confirmação comercial.*\]$/)
  })

  it('não afirma meios de pagamento, taxas ou percentuais sem fonte', () => {
    for (const item of faqItems) {
      expect(item.answer).not.toMatch(/%|pix|crédito|débito|cartão|dinheiro|parcela/i)
    }
  })

  it('usa ids únicos', () => {
    expect(new Set(faqItems.map((item) => item.id)).size).toBe(faqItems.length)
  })
})

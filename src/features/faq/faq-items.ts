export type FaqItem = {
  id: string
  question: string
  answer: string
}

/** Textos entre colchetes são placeholders: aguardam confirmação do estabelecimento. */
export const faqItems: FaqItem[] = [
  {
    id: 'tamanhos',
    question: 'Qual a diferença entre o barril de 30 e o de 50 litros?',
    answer:
      'Só o volume. Use o de 30 L para grupos menores e o de 50 L para festas. [Incluir rendimento em copos.]',
  },
  {
    id: 'entrega',
    question: 'Vocês entregam no meu bairro?',
    answer: '[Listar bairros e cidades atendidas, taxa e prazo.]',
  },
  {
    id: 'instalacao',
    question: 'O que preciso informar para a instalação?',
    answer: 'Avise se há escadas no local e se a tomada é 110 V ou 220 V.',
  },
  {
    id: 'pagamento',
    question: 'Quais as formas de pagamento?',
    answer:
      '[Formas de pagamento e eventuais acréscimos aguardam confirmação comercial do estabelecimento.]',
  },
]

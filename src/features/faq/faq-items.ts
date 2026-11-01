export type FaqItem = {
  id: string
  question: string
  answer: string
}

export const faqItems: FaqItem[] = [
  {
    id: 'tamanhos',
    question: 'Qual a diferença entre o barril de 30 e o de 50 litros?',
    answer:
      'Só o volume. O barril de 30 L rende cerca de 60 copos de 500 ml (ou 100 de 300 ml), ideal para grupos menores. O de 50 L rende cerca de 100 copos de 500 ml (ou 160 de 300 ml), recomendado para festas e eventos maiores.',
  },
  {
    id: 'entrega',
    question: 'Vocês entregam no meu bairro?',
    answer:
      'Entregamos em São João del-Rei e região. A confirmação para o seu bairro, além de prazo, agendamento de horário e eventual taxa de entrega, é realizada diretamente no atendimento via WhatsApp.',
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
      'As condições e opções de pagamento são informadas mediante confirmação comercial do estabelecimento no atendimento.',
  },
]

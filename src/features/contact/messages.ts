/** Mensagens iniciais da conversa. Centralizadas para não espalhar texto pelos componentes. */
export const messages = {
  order: 'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir um chopp.',
  prices:
    'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de consultar os valores dos barris.',
  promo: 'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de saber da promoção.',
  contact: 'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de conversar.',
} as const

export type MessageKey = keyof typeof messages

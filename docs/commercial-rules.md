# Regras comerciais confirmadas pelo proprietário

## Operação exclusivamente por delivery

**O Chopp Delivery oferece apenas entrega. Não existe retirada no estabelecimento.**
Nenhuma superfície pública pode apresentar retirada como modalidade disponível: texto fixo,
metadados, faixa animada, mensagens do WhatsApp, itens de demonstração e valores iniciais do futuro
CMS (F4).

### O que foi corrigido (F3C.5)

| Onde | Antes | Agora |
| --- | --- | --- |
| Hero (`Hero.tsx`, `HeroRefined.tsx`), selo | Delivery e retirada · Barris 30 e 50 L | Delivery · Barris 30 e 50 L |
| Hero, texto | …o horário. A gente entrega ou você retira. | …o horário. A gente entrega. |
| Bloco do catálogo (`ExpandableCatalogView.tsx`), título | Delivery e Retirada | Delivery |
| Bloco do catálogo, texto | …A gente entrega ou você retira. Consulte condições para seu endereço. | …A gente entrega. Consulte condições para seu endereço. |
| Faixa animada (`Ticker.tsx`, `TickerMarquee.tsx`) | Chope gelado · Barril 30 L · Barril 50 L · Delivery · **Retirada** | … · Delivery · **Delegas** |
| `index.html`, meta description | …com entrega e retirada. | …com entrega. |

A frase "Delegas" substitui "Retirada" na faixa por ser a marca do estabelecimento (não é promessa
comercial) e por ter tamanho parecido, o que mantém a cobertura da faixa em movimento. Se o
estabelecimento preferir outra palavra, é uma troca de uma linha em `Ticker.tsx` e
`TickerMarquee.tsx` (e no teste `ticker-marquee.test.ts`).

Nada legítimo sobre entrega foi removido: FAQ "Vocês entregam no meu bairro?", "Delivery" na faixa e
no selo, "A gente entrega.", "Consulte condições para seu endereço.", aviso 18+ e rodapé.

### Proteção contra regressão

`src/pages/landing/delivery-only.test.ts`:

1. varre o código público (landing, catálogo, contato, FAQ, motion, compliance, `src/app`,
   `src/shared`) e o `index.html` e falha se encontrar oferta de retirada;
2. renderiza a landing inteira e o bloco do catálogo e faz a mesma checagem no HTML final;
3. mostra, com casos explícitos, que o detector reconhece as formas antigas ("Delivery e
   Retirada", "ou você retira", "retire no local", "buscar o pedido na loja"…) e não acusa texto
   legítimo de entrega.

### Valores iniciais do futuro CMS (F4)

Os textos de partida do CMS devem ser **os textos atuais corrigidos acima**: nenhum seed pode
reintroduzir retirada, e as seções de entrega/contato partem dos placeholders existentes. O teste
acima deve cobrir também o seed quando ele existir (acrescentar o arquivo do seed à lista
`PUBLIC_DIRS`).

## Pontos ambíguos que dependem de confirmação comercial (não foram inventados)

- **"…e o horário."** (Hero e bloco do catálogo): sugere que o cliente escolhe um horário de
  entrega. Confirmar se existe agendamento ou se é só combinar no atendimento.
- **"Consulte condições para seu endereço."**: não informa área atendida, taxa, prazo nem pedido
  mínimo. Nenhum desses dados foi inventado. FAQ "Vocês entregam no meu bairro?" continua com o
  placeholder `[Listar bairros e cidades atendidas, taxa e prazo.]`.
- **Formas de pagamento, horário de atendimento, endereço e Instagram** seguem como placeholders
  em `faq-items.ts` e `contact/config.ts`. Atenção: o endereço do estabelecimento aparece no
  rodapé como dado de contato; como não há retirada, convém confirmar se ele deve ser exibido ao
  público ou apenas servir de referência.

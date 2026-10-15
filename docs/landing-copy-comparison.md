# Landing: textos antigos e novos (comparação, sem alteração)

Referência "antes": landing de `1d98c48` (`CatalogSection`, `PriceTable`, `CachacaBanner`).
Referência "agora": `integration/delegas-f3` com a F3C.5 (HEAD `061c778` + alterações pendentes).
Este documento só registra; **nenhum texto comercial foi alterado**, exceto o item 11 (retirada),
autorizado explicitamente (ver `docs/commercial-rules.md`).

| # | Elemento | Antes | Agora | Quando mudou | Situação |
| --- | --- | --- | --- | --- | --- |
| 1 | Nota do catálogo, catálogo padrão (30/50 L) | "Oito opções de chopp, com valores do barril de 30 e de 50 litros." | "8 opções de chopp com valores e apresentações disponíveis." | F3C.4 | **Pendente de aprovação** |
| 2 | Nota, catálogo fora do padrão | "Consulte os valores e as apresentações disponíveis." | "N opções de chopp com valores e apresentações disponíveis." | F3C.4 | **Pendente de aprovação** |
| 3 | Nota, sem nenhum chope | (nota do padrão) | "Consulte nossa carta de chopes e bebidas especiais." | F3C.4 | **Pendente de aprovação** |
| 4 | Carregando | "Carregando catálogo…" | igual | — | Igual |
| 5 | Erro + botão | "Catálogo indisponível no momento. Tente novamente." / "Tentar novamente" | igual | — | Igual |
| 6 | Sem chopes | "Nenhum chope disponível no catálogo no momento." | igual | — | Igual |
| 7 | Cabeçalho da tabela | "Chopp · Barril 30 L · Barril 50 L" | "Produto · Barril de 30 L · Barril de 50 L" (rótulo vem da API) | F3C.3/F3C.4 | **Pendente de aprovação** |
| 8 | Tamanho sem preço | "—" + "não disponível" (oculto) | igual; nos cards e no layout por produto também "Indisponível" visível | F3C.4 | Novo texto visível |
| 9 | Preço | texto "R$ 510" | botão com o preço; ao acionar abre o WhatsApp com mensagem do produto | F3C.3/F3C.4 | Comportamento novo (aprovado em F3C.3) |
| 10 | Cachaça | banner "Cachaça / descrição / Garrafa 700 ml · R$ 30,00" | seção "NOSSA SELEÇÃO · CACHAÇAS · Confira nossas opções de cachaça e escolha sua garrafa.", selo "Disponível no cardápio", "Selecione o tamanho da garrafa:" / "Selecione uma garrafa acima" (várias garrafas) e botão "Pedir {nome} {garrafa} no WhatsApp" | F3C.3/F3C.4 | **Pendente de aprovação** |
| 11 | Bloco "Delivery" (novo na landing) | (não existia) | título "Delivery"; "Escolha o chope ou cachaça, o tamanho e o horário. A gente entrega. Consulte condições para seu endereço." | F3C.4; **retirada removida na F3C.5** | Retirada: corrigido. Bloco em si: **pendente de aprovação** |
| 12 | Hero, selo e texto | "Delivery e retirada · Barris 30 e 50 L" / "…A gente entrega ou você retira." | "Delivery · Barris 30 e 50 L" / "…A gente entrega." | F3C.5 | Correção comercial autorizada |
| 13 | Faixa animada | "… Delivery · Retirada" | "… Delivery · Delegas" | F3C.5 | Correção comercial autorizada (palavra a confirmar) |
| 14 | Meta description | "…com entrega e retirada." | "…com entrega." | F3C.5 | Correção comercial autorizada |
| 15 | Mensagens do WhatsApp dos itens | genéricas ("…gostaria de pedir um chopp.") | "Olá! Gostaria de pedir {produto}, {apresentação}, por R$ {preço}." / "…uma garrafa de {nome} {garrafa} por R$ {preço}." | F3C.3/F3C.4 | Novo; exige atendimento confirmar preço |
| 16 | Cor do chip indisponível | opacidade 0,5 (reprovada pelo axe, contraste) | opacidade 0,8 | F3C.5 | **Mudança visual mínima; precisa de olhar humano** |

## O que a F3C.5 não faz

Não restaura nem reescreve os itens 1 a 3, 7, 10 e 11 (exceto a retirada). O plano da F3C.5
oferece três caminhos para a nota (restaurar o texto antigo, aprovar o novo ou usar um neutro) e
aguarda decisão.

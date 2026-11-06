# D2R — três direções de dark mode do painel

Protótipos isolados. Nenhum arquivo da aplicação foi alterado: cada paleta só sobrescreve os tokens `--theme-*` quando o painel recebe `data-dark-proto="a|b|c"` e é injetada pelo `capture.mjs`. O tema escuro atual (D2) continua em `src/styles/themes.css`.

- `build.mjs` gera `a.css`, `b.css`, `c.css` e `contrast.md` (razões WCAG calculadas).
- `capture.mjs` captura contra `npm run preview:admin:theme` (fixtures somente leitura, porta 4321) e gera `shots/` e `comparativo.html`.
- `states.html` é o quadro de estados (botões, campos, avisos), só com tokens `--theme-*`.

Reexecutar: `node prototypes/dark-d2r/build.mjs && node prototypes/dark-d2r/capture.mjs`.

## Comparação

| Critério | A · Brasa Premium | B · Adega Noturna | C · Metal & Malte |
| --- | --- | --- | --- |
| Base | grafite quente `#141211` | antracito frio `#0f1115` | gunmetal esverdeado `#131719` |
| Ação primária | cobre `#dc8a4c` | bordô `#8a2a3f` | dourado queimado `#c9973b` |
| Acento de texto | âmbar `#ebac62` | champanhe `#dcc89f` | dourado `#d9a74c` |
| Texto / fundo | 16,2:1 | 15,7:1 | 15,4:1 |
| Botão primário | 6,9:1 | 7,6:1 | 7,1:1 |
| Borda de campo / superfície | 4,6:1 | 4,8:1 | 4,9:1 |

Todos os pares de `contrast.md` ficam acima de 4,5:1 para texto e de 3:1 para bordas e foco.

## Avaliação

**A · Brasa Premium**
- Pontos fortes: hierarquia mais clara, porque o cobre se destaca e o resto é neutro. Boa leitura prolongada, com tons quentes e sem verde residual. É a mais próxima do tom do produto (chopp, âmbar).
- Defeitos: é a mais previsível, pois grafite com cobre é comum em painéis "premium". O aviso informativo azul destoa da base quente. O botão desabilitado fica marrom opaco, bem parecido com o ativo em baixa luz (visível em "Salvar", 390px).

**B · Adega Noturna**
- Pontos fortes: é a mais editorial e a mais distinta das três. O bordô na ação primária e o champanhe nos acentos dão personalidade própria.
- Defeitos: o bordô primário se confunde com o estado de erro e de exclusão (ambos vermelhos), um risco de usabilidade num painel que apaga e publica. O bordô quase não contrasta com o fundo; a ação se distingue pelo texto claro, não pela forma do botão. A base fria afasta o painel do universo do chopp e da vitrine pastel.

**C · Metal & Malte**
- Pontos fortes: é a que mais lembra o universo cervejeiro (malte, metal). A ação em dourado tem boa presença e o verde-oliva discreto ajuda em sucesso e superfícies de destaque.
- Defeitos: o dourado e o verde-oliva se aproximam do verde escuro do tema rejeitado, e o risco de parecer "o D2 com outra cor" é real, sobretudo nas superfícies. Ação (dourado) e aviso (amarelo) têm tons próximos.

## Recomendação

**A · Brasa Premium**, como base, com duas correções antes de implementar: aproximar o aviso informativo do tom neutro e tornar o botão desabilitado mais distinguível do ativo. Ela é a que menos arrisca confusão semântica (B) ou parentesco com o tema rejeitado (C) e tem o maior contraste de texto sobre fundo (16,2:1). O contraste do botão primário é o menor das três (6,9:1), ainda acima de 4,5:1. B é a alternativa se a prioridade for personalidade editorial; nesse caso, a ação primária precisa deixar de ser vermelha.

Esta é uma recomendação, não uma escolha: nada foi implementado no tema oficial.

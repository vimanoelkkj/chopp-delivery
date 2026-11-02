# F4A.4-A — P0 + P1: fundação pura do layout editorial

## Autoridade, escopo e baseline

Branch `integration/immersive-cms-f4a`; HEAD preservado `a6528635456ccde14a7e48a35d7aae794ca5e236`, índice inicialmente vazio. Referências normativas: pedido P0–P1, contratos CMS v2 consolidados e [fechamento da Etapa 4](immersive-cms-stage4.md). O usuário confirmou que a arquitetura F4A.4 do Claude foi entregue em conversa e não existe como documento local. Não foi inventada uma especificação histórica: as políticas locais de implementação são identificadas abaixo.

Escopo: testes de caracterização da homepage e `deriveLayout` compartilhada. Nenhum componente React, rota, handler, repositório, contrato comercial, iframe, endpoint de mídia, publicação ou editor foi implementado/alterado. P2 não iniciado.

Autorização adicional expressa: os harnesses existentes podem aplicar automaticamente **somente migrations 0001–0009 aprovadas em D1 descartável próprio**. Não houve aplicação operacional ou comando remoto de migration. Configurações temporárias/IDs de banco e diretórios de posse seguem os harnesses existentes. Nenhuma migration foi criada ou editada.

## P0 — caracterização antes da implementação

`e2e/cms-layout-characterization.spec.ts`: quatro testes, em 390px e 1440px, aprovados **antes** de criar a implementação de layout. Cada viewport cobre composição/landmarks/navegação e catálogo/variantes/WhatsApp. Evidência original: `%TEMP%/chopp-f4a4-a/p0-green.log`, `p0-results.json`, `p0-390-structure.json`, `p0-1440-structure.json` e respectivas árvores `landmarks.yaml`.

Composição observada dos nove filhos diretos de main:

1. Hero (`hero-title`).
2. Barris (`barris-title`).
3. Ticker (div decorativa).
4. Catálogo (`chopes-title`).
5. Como funciona (`como-title`).
6. História (`sobre-title`).
7. Promoções (`promo-title`).
8. FAQ (`faq-title`).
9. Contato (`contato-title`), incluindo footer interno.

IDs estáveis registrados nos dois tamanhos: `root`, `topo`, `conteudo`, `hero-title`, `barris`, `barris-title`, `carousel-track`, `chopes`, `chopes-title`, `como`, `como-title`, `sobre`, `sobre-title`, `promo-title`, `faq`, `faq-title`, `contato`, `contato-title`. Os IDs automáticos React também são registrados no JSON e verificados quanto à unicidade; não são fixados por seu valor gerado.

Landmarks: banner, navigation Principal, main e regiões nomeadas pelos headings; aviso de entrega é complementary. Footer está dentro da seção de contato, não foi inventado um contentinfo global. Há um único h1. Os links internos observados são `#conteudo`, `#topo`, `#barris`, `#chopes`, `#como`, `#faq`; todos devem ter alvo. Navegação principal mantém a sequência barris/chopes/como/faq. Desktop navega e volta ao topo; mobile abre menu, torna o link visível e fecha ao clicar. Overflow horizontal é verificado; os testes públicos existentes completam as verificações geométricas/motion.

O cenário comercial lê o catálogo real do D1 descartável e sobrepõe **somente a resposta da página** com variantes controladas 30 L/R$ 510,00, 50 L/R$ 750,00 e 1.500 ml/R$ 19,99. Seleciona 1,5L, verifica seleção/preços e CTA; confirma catálogo original inalterado por outra requisição. Esses valores são fixtures de teste, não informação comercial nova.

Observações da calibração inicial, sem modificar a homepage: o texto do h1 contém br sem espaço literal; o volume é compacto `1,5L`; o CTA comercial fica fora do article ativo. Os novos seletores foram corrigidos conforme o DOM observado. A seleção atual não usa aria-pressed; o teste caracteriza a classe de estado `priceSelected`, independente do hash CSS. Essa limitação de acessibilidade preexistente foi registrada, sem correção React neste checkpoint. Nenhuma asserção legada foi alterada.

O teste aceita o caminho com telefone configurado e valida a query da mensagem (produto, volume e preço). Nesta execução de produção normal, o telefone está ausente: o comportamento efetivamente observado foi o aviso honesto de número não configurado. Não se apresenta esse ramo como envio de WhatsApp; código comercial existente permanece intacto e seus testes continuam nos gates.

## P1 — contrato de deriveLayout

Arquivo de produção `shared/cms/layout.ts`, reexportado pela fachada `shared/cms.ts`. Entrada: `CmsDocumentV2` **já validado**, JSON do contrato existente. A função não substitui o validador completo e não valida conteúdo editorial/comercial ou disponibilidade de catálogo/R2.

| Campo retornado | Significado |
|---|---|
| `sections[]` | Somente módulos visíveis, na ordem original, com `id`, `template`, `anchor`, `navigation`, `position`, `number`. Não contém content, imagens, produtos ou preços. |
| `navigation[]` | `moduleId`, `template`, `href` e `kind` (`primary` ou `cta`), derivados de módulos visíveis com navegação habilitada e alvo existente no plano. Não fabrica rótulos editoriais. |
| `homeHref` | `#topo` no plano válido; null quando há erro estrutural. |
| `heroCarouselHref` | `#barris` somente com carousel presente e visível; null quando ausente/oculto ou plano inválido. |
| `diagnostics[]` | Códigos, severidade e índice original opcional (zero-based); sem eco de conteúdo editorial ou URLs arbitrárias. |

Requisitos aprovados: gramática Hero → Carousel? → Ticker? → Catalog → Institucionais → Contact; ordem editorial preservada; ausência de links órfãos; diagnósticos; isolamento do servidor/React; nenhuma mutação CMS.

**Decisões técnicas locais**, não atribuídas retroativamente ao documento ausente do Claude:

- `CMS_RULES_V2` é a autoridade compartilhada de slots, âncoras, cardinalidade e navegação. Não se importa a fachada de servidor. A proteção defensiva de IDs opcionais espelha o formato module_UUID v4 atual; o validador consolidado continua obrigatório antes de chamar a função.
- `position` é ordinal 1-based de todos os módulos visíveis. `number` é string 01, 02… somente para carousel/catalog/how/about/faq. Hero, ticker, highlights promocionais e contact ficam sem número, refletindo o Conceito C atual. Ocultação/reordenação recalcula o contador sem lacunas; não se persiste numeração no CMS.
- O contrato CMS continua com `hero.anchor = inicio`. Somente a projeção de layout mapeia para `topo` (`CMS_LAYOUT_HOME_ANCHOR`), correspondente ao wrapper público atual. Nenhum ID/valor do documento é reescrito e nenhum link #inicio é emitido. Não foram inseridos aliases no DOM.
- Primários e CTA são distinguidos em `kind`. O Contato pode produzir CTA interno #contato no plano, conforme o contrato; isso não substituiu o botão WhatsApp público atual.
- Qualquer erro estrutural falha fechado: arrays de seção/navegação vazios e hrefs null. Não se retorna composição parcial ou reordenada artificialmente. IDs duplicados são detectados também em módulos ocultos.
- Carousel vazio permanece seção/destino explícito quando visível, com `CAROUSEL_EMPTY`; não se inventam entries ou mídia. Ausência/ocultação produz os avisos `COMPOSITION_WITHOUT_CAROUSEL`/`CAROUSEL_HIDDEN` e remove seu link. O futuro renderer deve seguir o mesmo plano para manter coerência entre destino e link.
- Metadados estruturais são lidos por descritores de propriedades, sem executar getters. Conteúdo não é projetado; só se observa o tamanho do array entries para diagnosticar vazio. A garantia é sobre JSON CMS v2 validado, não sobre execução segura de objetos Proxy arbitrários fornecidos como JavaScript.

## Testes adversariais e efetividade

`tests/backend/cms-layout.test.ts`: **20 testes**, todos vermelhos antes da implementação (`p1-red.log`), sem falha de carregamento de import. A fachada antiga fornece resultado vazio no adaptador de teste da fase vermelha; as asserções detectam a ausência dos metadados e diagnósticos. Depois da implementação, 20/20 verdes (`p1-green-final.log`). Typecheck detectou uma omissão no tipo interno de candidatos (visible) e um cast de fixture inválida; ambos corrigidos sem mudar expectativas de execução.

- 720 permutações dos seis institucionais, preservando IDs, ordem, navegação e números.
- 512 documentos com as 256 máscaras de oito módulos opcionais, em dois modos: ocultos ou ausentes. Todos passam pelo validador CMS existente antes da derivação; os links precisam apontar a seções retornadas.
- Carousel vazio, obrigatório ausente/oculto, IDs duplicados inclusive ocultos, identidade/ID inválidos, template desconhecido, excesso de template, cruzamento de slots e tentativa de navegação sem âncora.
- Envelopes inválidos, sem coerção de schema. Erro produz diagnósticos específicos e nenhum link parcial.
- Accessor editorial que lança, âncora injetada javascript:, probes de fetch/cookies/storage: nenhum é avaliado/usado para produzir URLs.
- Entrada congelada, repetição determinística e mutação da saída: documento CMS permanece intacto e saídas são independentes.
- Bundle em memória com esbuild `platform: neutral`, sem escrever artefato: closure somente de módulos compartilhados, sem import servidor/React/externo, sem ciclos. Auditoria de chamadas proibidas complementa as probes de runtime; não é tratada como sandbox para código arbitrário.

Esses cenários detectam filtros/ordenação indevidos, numeração persistida/errada, emissão de links para ocultos, perda do mapeamento de topo, corrupção silenciosa de IDs, exposição de conteúdo e dependência imprópria. Contagens de documentos/permutação são iterações internas e não inflacionam o número de testes.

## Comparação com a homepage atual

| Aspecto | Homepage pública preservada | Layout derivado, ainda não consumido |
|---|---|---|
| Composição | Fixa em LandingPage, com ticker e promoções atuais. | Do documento validado, preservando instituições reordenáveis e visibilidade. |
| Topo | Wrapper #topo; não existe #inicio. | Hero mapeado a topo sem alterar o contrato CMS. |
| Navegação | Quatro links estáticos no menu; WhatsApp separado. | Primários/CTA do contrato, sem ocultos/ausentes e sem rótulos inventados. |
| Hero → barris | CTA público atual, com destino público existente. | CTA lógico condicional à existência de carousel visível; não controla o React atual. |
| Números | Barris 01, catálogo 02, como 03, história 04, FAQ 05; promo sem número. | Mesma política visual, calculada sobre a composição visível e sua ordem. |
| Catálogo e WhatsApp | APIs, variantes/volumes, preço e mensagem existentes. | Não são recebidos nem modificados; apenas referências de módulo e destino. |
| Imagens | Componentes/imagens aprovados do Conceito C. | Nenhuma resolução de mídia ou imagem. |

Não há interface, iframe, rota ou consumo do documento CMS pela homepage. Nenhum arquivo em src foi alterado. A função compartilhada não decide preço, disponibilidade ou semântica comercial.

## Graphify

Skill lida e consulta inicial antes da implementação. Vocabulário selecionado do grafo: cms, landing, nav, links, catalog, section, hero, handlers, validation, carousel, contact. Query e explain de LandingPage e contrato v2 foram conferidos em código. O grafo confirmou separação entre composição React/catalogue e backend administrativo.

Reavaliação após todos os gates, evitando sobreposição da extração AST com testes sensíveis a carga: `graphify update .`, exit 0. Resultado: **1552 nós, 4019 arestas e 93 comunidades**, sem ciclos no subgrafo dirigido de imports/reexports. O JSON global é não direcionado; a verificação reconstrói as direções source/target dessas relações.

Explain de `shared/cms/layout.ts:L1`/`deriveLayout:L61` confirma imports diretos apenas de common (tipo) e v2 (regra/tipos). Closure de importação em AST: common/v1/v2 compartilhados, sem servidor ou React. O teste de bundling neutral confirma também a closure compilada. LandingPage continua sem dependência CMS; sua composição/catalogue não passaram a consumir deriveLayout.

A consulta inicial alterou somente `graphify-out/cache/last_query_stamp`. A atualização gerou 9 arquivos alterados e 3 novos caches AST, sem remoção, todos em graphify-out ignorado. Comparação antes/depois confirmou ausência de alteração fora da pasta gerada, incluindo configurações e hooks. A saída Graphify não pertence ao manifesto P0–P1. Logs query/explain/update, `graph-final-summary.json`, `graph-operational-changes.json` e `graph-changes.json` ficam em TEMP.

Limites: nove SQLs sem extração por ausência de tree_sitter_sql; 43 arquivos sem símbolos. Não houve instalação de dependência, extração semântica ou chamada a API de modelo (custo externo de extração: 0 tokens). O grafo não prova runtime, SQL ou comportamento visual; essas verificações usam código, testes e caracterização. O grafo incorpora o working tree P0–P1 não commitado sobre HEAD a652863.


## Gates finais

Todos os gates finais foram aprovados, sem testes pendentes ou falhando.

| Comando | Exit code | Duração (s) | Resultado |
|---|---:|---:|---|
| `npm run typecheck` | 0 | 1.00 | Aprovado |
| `npm run lint` | 0 | 0.56 | Aprovado |
| `npm test -- --maxWorkers=1` | 0 | 565.55 | 1.148/1.148, 81 arquivos; 20 casos novos P1 |
| `npm run build` | 0 | 1.67 | Aprovado |
| `npm run verify:dist` | 0 | 0.72 | Aprovado |
| `npm run build:release` | 0 | 2.11 | Aprovado |
| `npm run verify:release` | 0 | 0.36 | Aprovado |
| `node %TEMP%/chopp-f4a4-a/public-runner.mjs` | 0 | 18.03 | 61/61: 57 existentes + 4 novos P0 |
| `npm run test:e2e:real` | 0 | 158.25 | 21/21; D1 próprio por caso |
| `npm run test:e2e:release` | 0 | 159.51 | 21/21; gateway HTTP real |
| `git diff --check` | 0 | — | Sem erros de whitespace |

Comandos/exit codes em `gates.json`; logs por gate no diretório TEMP da entrega. A comparação independente entre os anexos P0 anteriores à implementação e os novos anexos da suíte pública final encontrou **composição, todos os IDs, links e descritores de seções exatamente iguais nos dois viewports**, inclusive os IDs gerados nesta execução. Resultado em `p0-p1-structure-comparison.json` e capturas `p1-390-structure.json`/`p1-1440-structure.json`. Isso documenta a preservação estrutural; não pretende substituir uma auditoria visual pixel a pixel.


Os E2E são sequenciais e usam os runtimes existentes com bancos D1 próprios em TEMP, incluindo somente migrations aprovadas. A seleção pública acrescenta os quatro novos testes de caracterização aos 57 existentes. Não foram adicionados retries, skips ou aumentos de timeout.

## Manifesto e preservação

Entrega exclusiva prevista: cinco arquivos, um modificado e quatro novos:

- `shared/cms.ts`: um reexport de layout; contratos legados e nomes preservados.
- `shared/cms/layout.ts`: implementação pura e tipos do resultado.
- `tests/backend/cms-layout.test.ts`: testes de contrato/isolamento do layout.
- `e2e/cms-layout-characterization.spec.ts`: caracterização pública desktop/mobile e comercial.
- `docs/immersive-cms-f4a4-a.md`: este relatório.

HEAD e branch preservados; índice vazio. Dos 366 arquivos rastreados do baseline, somente shared/cms.ts mudou, com um reexport. Os outros 365 são byte a byte iguais ao início, inclusive todos os componentes React, APIs, contratos comerciais, testes legados, package/configurações e migrations. As quatro fontes de código/teste da entrega mantiveram seus hashes durante os gates e a atualização Graphify. Configurações externas e a correção CP0 permanecem fora do manifesto, sem restauração ou formatação.

Manifesto exclusivo e SHA-256 finais: `%TEMP%/chopp-f4a4-a/delivery-files.txt` e `delivery-hashes.json`; hashes das nove migrations em `migration-hashes.json`. Nenhuma migration original ou banco mantido foi alterado. O inventário final, incluindo o hash deste relatório, está em `final-preservation.json` (fora do próprio documento para evitar circularidade).

| Arquivo protegido | SHA-256 inicial = final |
|---|---|
| `.gitignore` | `8e50a25a8e259b2912835c6a77a1b03dfd0558e24315c1d1470a5972af587668` |
| `.claude/settings.json` | `f4e5f81ee806e3792a2c9c57285c1ce009be083019f42ac8e435bd4790ab8b2a` |
| `.claude/settings.local.json` | `21dcff94caa79881e580b87945186af2bd9c54ada5665497196b9bd835f9f816` |
| `CLAUDE.md` | `55189e0bb8f83d9de53de3142fc8702c6ec45d01df3478da4b8224cb0d20d83c` |
| `docs/immersive-cms-stage4-spec.md` | `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873` |
| `e2e/catalog-atomic-routes.spec.ts` | `0abbe95a5ac242093f8f4227aa321577a7a2ddd6b9c18157a78aaae1b64c5985` |

Estado final (`git status --short --untracked-files=all`):

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
 M shared/cms.ts
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-f4a4-a.md
?? docs/immersive-cms-stage4-spec.md
?? e2e/cms-layout-characterization.spec.ts
?? shared/cms/layout.ts
?? tests/backend/cms-layout.test.ts
```

A árvore não está limpa: há um modificado/quatro novos da entrega e as alterações externas preexistentes, explicitamente separados. `.claude/settings.local.json` continua ignorado e preservado. Nenhum arquivo foi adicionado ao índice.


## Riscos residuais e checkpoint

A função pressupõe validação CMS v2 anterior; não é renderer, validador de publicação ou mecanismo de autorização. A integração futura deve consumir seções e links do mesmo plano, preservar as regras comerciais e decidir rótulos de navegação sem duplicar fontes de verdade. O mapeamento inicio/topo e a política de numeração estão explicitamente documentados para auditoria, não implantados na UI.

Permanecem pendências da Etapa 4: quota vitalícia de 100 mídias e retenção/GC, função visual de carousel.media, editor, publicação/renderização CMS, IDs de bancos mantidos não inspecionados e futura validação Cloudflare isolada. A sensibilidade local à exaustão de portas motiva um worker Vitest e execução sequencial. Não houve acesso a banco mantido nem operação remota.

**GO técnico para auditoria independente de P0–P1.** Caracterização antes/depois preservada, função pura implementada, testes adversariais e gates completos aprovados, sem ciclos/dependências indevidas confirmados. O documento arquitetural original do Claude não está no repositório; o relatório distingue os requisitos confirmados pelo usuário das decisões locais.

Nenhum commit, push, merge, rebase, staging, deploy ou migration operacional foi executado. Aplicação automática das migrations aprovadas foi limitada aos D1 descartáveis dos harnesses existentes, conforme autorização expressa. P2, iframe, editor, endpoints de mídia, publicação e integração React não foram iniciados. Checkpoint encerrado para auditoria do Antigravity.

# F4A.4-A — P3: adaptação editorial dos componentes

## Escopo e baseline

Branch `integration/immersive-cms-f4a`, HEAD `f4e366da6769a929cb35db5a2f594d74866b3a0f`, índice vazio. Referências: `docs/immersive-cms-stage4.md`, `docs/immersive-cms-f4a4-a.md`, `docs/immersive-cms-f4a4-a-p2.md`, `shared/cms/layout.ts` e contratos CMS v2 existentes. A arquitetura original foi entregue em conversa; o pedido P3 define o escopo desta execução.

Foram adaptadas nove seções existentes. A composição fixa de LandingPage, SiteHeader, StickyCta, navegação, âncoras, numeração de seções, scroll, CSS, animações e imagens permanecem intactos. Nenhum iframe, renderer dinâmico, editor, rota HTTP, endpoint de mídia, contrato, handler, repositório, migration ou publicação foi implementado. Nenhum commit ou operação remota. P4 não iniciado.

## Contratos de props

Toda prop nova se chama `editorial`, é opcional e referencia **somente tipos** de `shared/cms/v2.ts`. Não foi duplicado um contrato CMS nem importado código de servidor. A ausência da prop mantém o JSX original como fallback; strings vazias/listas vazias explícitas não são substituídas silenciosamente por conteúdo inventado.

| Componente | Tipo de editorial | Destino visual / limites |
| --- | --- | --- |
| Hero | `Pick<CmsContentsV2['hero'], 'heading' \| 'summary'>` | H1 e parágrafo existentes. CTAs, mídia, badges, preço mínimo e AgeNotice preservados. |
| BarrelsSection | `Pick<CmsContentsV2['carousel'], 'heading' \| 'lead'>` | Cabeçalho da vitrine. BarrelCarousel3D continua recebendo somente os itens comerciais da API. |
| CatalogSection | `CmsContentsV2['catalog']` | H2 e introdução. Categorias, produtos, estados de API, preços e fallback VariantCatalog intactos. |
| Ticker | `CmsContentsV2['ticker']` | Frases na faixa e cópia aria-hidden existente. |
| HowItWorks | `CmsContentsV2['how']` | H2 e lista de passos, com título/body nos elementos existentes e números por posição. Lead/eyebrow sem campo CMS permanecem fixos. |
| AboutSection | `Pick<CmsContentsV2['about'], 'heading' \| 'body'>` | H2 e body no parágrafo lead existente. Quando há editorial, os dois parágrafos institucionais padrão dão lugar a esse body único; evita reter uma afirmação histórica padrão junto do novo texto. Imagem/caption permanecem locais. |
| PromoSection | `Pick<CmsContentsV2['highlight'], 'heading' \| 'body'>` | H2 e parágrafo. Ação/label/contexto WhatsApp preservados. |
| FaqSection | `CmsContentsV2['faq']` | Heading e itens no acordeão existente; IDs locais derivados da posição para ligar botões/painéis, com useId do Faq. IDs padrão permanecem sem mudanças quando editorial está ausente. |
| ContactSection | `CmsContentsV2['contact']` | H2 e body. CTA/ref, contato comercial, footer e AgeNotice preservados. |

As listas ticker/passos aceitam textos duplicados sem chaves React duplicadas; as chaves combinam texto e ocorrência, sem depender de um índice de array como identidade. FAQ usa IDs locais de posição porque o contrato não contém IDs por pergunta; não se promete identidade editorial persistente após reordenação de perguntas.

Títulos CMS são texto simples no heading existente. Não se interpreta HTML nem se inventa divisão de uma string em trechos com destaque. Os fragments, quebras e spans autorais dos títulos padrão permanecem exatamente no fallback. Formatação editorial rica e regras para realçar partes do título não foram criadas.

## Captura antes de qualquer adaptação

Antes da edição dos nove componentes:

- Nove snapshots SSR em `editorial.test.tsx.snap`, gerados a partir dos componentes originais. Permaneceram aprovados sem atualização depois da implementação.
- Browser Chromium com build production e Pages/Functions reais em D1 descartável: 390×900 e 1440×900, cada um com prefers-reduced-motion reduce e no-preference. Registrados HTML completo do root, texto, IDs, links, landmarks, imagens, condição de movimento, árvore de acessibilidade e PNG full-page.
- Dois testes Playwright criaram referências DOM/PNG ainda com os componentes originais, antes da adaptação. Na execução final essas referências são somente lidas; `maxDiffPixels: 0`, sem retries/skip/fixme.

Capturas e logs: `%TEMP%/chopp-f4a4-a-p3/before/`, `baseline-ssr.log`, `baseline-browser.log`, `baseline-visual-tests.log`. Imagens desktop/mobile foram inspecionadas visualmente. A imagem de barril, catálogo real, CTAs, numeração e layout são os do Conceito C existente.

Os JSON de referência receberam exclusivamente formatação LF/quebra final exigida pelo Biome, preservando os valores JSON. As imagens de referência e o snapshot SSR original não foram substituídos. A comparação semântica dos JSON com a captura original e os hashes das imagens/SSR são registrados no fechamento. Duas tentativas iniciais de lint detectaram precisamente a formatação dos JSON novos; não foram alteradas regras/exclusões.

Para carregar imagens lazy antes da fotografia, o harness de captura define loading=eager temporariamente, aguarda decode e restaura os atributos originais. Aguarda fontes locais e usa animations=disabled na captura para obter estado estável; os testes também declaram reducedMotion=reduce. Não houve mudança no CSS ou comportamento público de movimento.

## Comparação DOM e visual

| Largura / movimento | DOM inicial→atual | Pixels: primeira observação | Pixels: baseline preservado→atual, controle adicional |
| --- | --- | --- | --- |
| 390px / reduce | Idêntico | 0 | 0 |
| 1440px / reduce | Idêntico | 0 | 0 |
| 390px / no-preference | Idêntico | 164.388 | 0 |
| 1440px / no-preference | Idêntico | 0 | 0 |

A primeira captura avulsa normal em 390px apresentou diferença transitória, preservada nos artefatos. Sua causa exata de pintura/tempo não foi isolada; não se declara que tenha sido comprovado um defeito do Chromium ou que a variação tenha ocorrido no código antigo. Para investigar, foi preservado o dist anterior antes do build final: seu entry `/assets/index-DPqB60cA.js` corresponde ao log da captura inicial. Um runtime descartável posterior serviu esse bundle via interceptação exclusivamente no teste, mantendo a API real local; outro controle serviu o bundle atual `/assets/index-BG9Z194F.js`. Os scripts carregados estão registrados nos JSON de controle. Não foi criada uma rota na aplicação nem uma segunda homepage.

Nas quatro condições, o controle com código antigo e atual apresentou pixels idênticos; os JSON completos do DOM e árvores acessíveis também coincidiram com o baseline original. O build atual repetido coincidiu inclusive com o PNG original em 390px normal. Esses controles são investigação adicional, sem retries em testes nem substituição de referências: os dois testes visuais determinísticos já haviam passado, e todas as observações continuam disponíveis. Não há regressão persistente confirmada; a sensibilidade da captura avulsa permanece risco residual explícito. Evidências: `baseline-dist/`, `baseline-build.json`, `baseline-repeat/`, `after-repeat/`, `control-pixels.json`, `control-baseline.log`, `control-after.log`.


Evidências: `after/`, `comparison.json`, `pixel-comparison.json`, `visual-after-tests.log`, `public-results.json`. Os testes P0 continuam cobrindo menu, âncoras, scroll, foco e fluxo comercial em desktop/mobile. A composição atual não utiliza deriveLayout; a função compartilhada permanece preparada para checkpoint posterior.

## Testes novos e garantias

`src/pages/landing/sections/editorial.test.tsx`: **37 casos**:

- Nove snapshots pré-adaptação, um por componente, provam equivalência do markup padrão.
- Nove casos de conteúdo editorial e landmarks/IDs acessíveis preservados.
- Nove casos de escape React para strings adversariais com script/ampersand. Não existe dangerouslySetInnerHTML.
- FAQ com dois botões/painéis, aria-controls/aria-labelledby coerentes e primeiro item aberto; listas/textos explicitamente vazios; substituição da história sem manter a afirmação padrão.
- Cinco volumes da API: 750 ml, 1.500 ml, 20 L, 30 L e 50 L; links WhatsApp antes/depois idênticos, nome/apresentação exatos e preço da API na interface.
- Duas variantes 20 L com valores distintos, combinadas com 30/50 L; todos os preços e labels preservados no fallback VariantCatalog.
- Hero preserva preço mínimo da API, CTAs/âncoras, imagem e AgeNotice mesmo recebendo um objeto editorial com campos extras de preço, volume, telefone e imageSrc: esses campos não são utilizados.

`e2e/cms-editorial-sections.spec.ts`: dois casos visuais/DOM, em 390 e 1440 px, com quatro referências novas (JSON e PNG por largura), capturadas antes da edição. Os testes exigem igualdade exata dos pixels e de texto, IDs, links e landmarks; alterá-los sem atualizar as referências causa falha. Nenhum componente foi copiado para uma segunda homepage.

O teste WhatsApp inicial assumiu preço dentro da mensagem e 0,75L para 750 ml. A inspeção do código e do baseline demonstrou que o carrossel atual envia produto/apresentação, omite preço na mensagem e usa `750 ml`, `1,5L`, `20L`, `30L`, `50L`. Os testes novos passaram a verificar esse comportamento existente e a igualdade dos hrefs antes/depois, mantendo a verificação de preço na interface. Nenhum teste legado ou fluxo comercial foi alterado para acomodar essas suposições.

## Separação comercial e lacunas explícitas

O CMS não define preços, volumes, variantes, itens ou mensagens de pedido nestas props. Esses valores continuam vindo exclusivamente de useCatalog/estado comercial e dos componentes existentes; não se passa editorial ao BarrelCarousel3D, KegCardsGrid ou VariantCatalog. Não há fetch CMS, cookies/storage ou import administrativo novo nas seções/homepage.

Não foram resolvidas referências de mídia. Hero/about/highlight.media e carousel.entries[].media exigem um caminho autorizado de resolução de mídia, indisponível neste escopo. `carousel.media` continua sem função visual definida. Não se introduziram URLs arbitrárias, resolução de mídia privada, fallback de imagem escolhido pelo CMS ou filtragem/reordenação comercial a partir de entries.

CTAs, textos de badges/eyebrows, captions, footer comercial e intro de how sem representação no contrato continuam fixos. São lacunas de editabilidade explícitas, não novos campos improvisados. O texto promocional é editorial; condições/preços comerciais não são deduzidos dele. Regras futuras de qualidade/aprovação de textos devem ser tratadas no fluxo editorial; publicação permanece bloqueada.

IDs e números de seção continuam fixos conforme solicitado. Um renderer futuro que suporte múltiplos highlights precisa definir IDs únicos para essas instâncias; não se afirma que seja seguro montar três PromoSection com os mesmos IDs atuais. Não foi implementada essa composição nem alterado o menu público.

## Graphify e dependências

Skill lida; consulta BFS prévia (287 candidatos, 79 exibidos no orçamento) e DFS posterior (99 candidatos, 60 exibidos), ambas no grafo existente com 1552 nós. Logs: `graph-before.log`, `graph-after.log`. Os resultados foram confirmados em LandingPage, nove seções, navegação, catálogo, contratos v2/common/v1 e no comportamento do browser.

As novas dependências são nove imports type-only de CmsContentsV2. O caminho de tipos v2→v1/common não retorna ao React; não foi introduzido ciclo ou import runtime de servidor/CMS/admin. O grafo existente não foi regenerado e não é apresentado como extração das novas arestas. Imports e bundles reais complementam seus limites; consultas foram truncadas pelo orçamento e não são prova exaustiva isolada.

Dos 45 arquivos do Graphify, somente o timestamp operacional `cache/last_query_stamp` mudou pelas consultas; os outros 44 hashes permanecem idênticos. Configurações e hooks externos preservados.

## Gates finais

| Gate / comando | Exit code | Duração (s) | Resultado |
| --- | --- | --- | --- |
| `npm.cmd run typecheck` | 0 | 1.22 | Aprovado |
| `npm.cmd run lint` | 0 | 0.67 | Aprovado |
| `npm.cmd test -- --maxWorkers=1` | 0 | 685.67 | 1185/1185; 82 arquivos |
| `npm.cmd run build` | 0 | 2.06 | Aprovado |
| `npm.cmd run verify:dist` | 0 | 0.86 | Aprovado |
| `npm.cmd run build:release` | 0 | 2.48 | Aprovado |
| `npm.cmd run verify:release` | 0 | 0.45 | Aprovado |
| `node C:\Users\zzzzz\AppData\Local\Temp\chopp-f4a4-a-p3\public-runner.mjs` | 0 | 24.3 | 63/63 |
| `npm.cmd run test:e2e:real` | 0 | 218.41 | 23/23 |
| `npm.cmd run test:e2e:release` | 0 | 216.14 | 23/23 |

Lint global: exit 0, com os 46 warnings e 16 infos preexistentes, sem diagnóstico novo nos arquivos P3. Nenhuma regra de lint foi alterada. `git diff --check`, verificação de whitespace dos arquivos novos e lint final estão registrados em `closing-checks.json`. Verificadores: 87 módulos públicos e 135 release, iguais ao baseline, sem novos imports administrativos, runtime CMS ou fixtures.


Gates executados sequencialmente; Vitest com maxWorkers=1. Públicos usam build production e Pages/Functions reais em D1 novo, sem painel mockado. Administrativo/release usam integralmente as suítes existentes e preservam a segurança P2. Os harnesses aplicaram somente migrations 0001–0009 aprovadas em D1 com UUID e diretório de posse temporários, sem acesso a banco mantido/remoto. Nenhuma migration foi modificada ou criada.

## Git, manifesto e hashes

Entrega: **17 arquivos, nove modificados e oito novos**. Branch/HEAD preservados, índice vazio. Árvore contém a entrega e as alterações externas preexistentes; não está limpa.

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
 M src/pages/landing/sections/AboutSection.tsx
 M src/pages/landing/sections/BarrelsSection.tsx
 M src/pages/landing/sections/CatalogSection.tsx
 M src/pages/landing/sections/ContactSection.tsx
 M src/pages/landing/sections/FaqSection.tsx
 M src/pages/landing/sections/Hero.tsx
 M src/pages/landing/sections/HowItWorks.tsx
 M src/pages/landing/sections/PromoSection.tsx
 M src/pages/landing/sections/Ticker.tsx
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-stage4-spec.md
?? e2e/cms-editorial-sections.spec.ts
?? e2e/cms-editorial-sections.spec.ts-snapshots/homepage-1440-dom-win32.json
?? e2e/cms-editorial-sections.spec.ts-snapshots/homepage-1440-win32.png
?? e2e/cms-editorial-sections.spec.ts-snapshots/homepage-390-dom-win32.json
?? e2e/cms-editorial-sections.spec.ts-snapshots/homepage-390-win32.png
?? src/pages/landing/sections/__snapshots__/editorial.test.tsx.snap
?? src/pages/landing/sections/editorial.test.tsx
?? docs/immersive-cms-f4a4-a-p3.md
```

Manifesto exclusivo: `%TEMP%/chopp-f4a4-a-p3/delivery-files.txt`; hashes: `delivery-hashes.json`. Comparação de preservação e migrations: `preservation-final.json`; proteções: `protected-final-hashes.json`. Esses artefatos temporários e as capturas de investigação ficam fora da entrega. As imagens PNG do diretório de snapshots são referências automatizadas intencionais dos testes, não dumps temporários.

| Arquivo protegido | SHA-256 inicial = final |
| --- | --- |
| `.gitignore` | `8e50a25a8e259b2912835c6a77a1b03dfd0558e24315c1d1470a5972af587668` |
| `e2e/catalog-atomic-routes.spec.ts` | `0abbe95a5ac242093f8f4227aa321577a7a2ddd6b9c18157a78aaae1b64c5985` |
| `.claude/settings.json` | `f4e5f81ee806e3792a2c9c57285c1ce009be083019f42ac8e435bd4790ab8b2a` |
| `.claude/settings.local.json` | `21dcff94caa79881e580b87945186af2bd9c54ada5665497196b9bd835f9f816` |
| `CLAUDE.md` | `55189e0bb8f83d9de53de3142fc8702c6ec45d01df3478da4b8224cb0d20d83c` |
| `docs/immersive-cms-stage4-spec.md` | `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873` |


## Riscos residuais e veredito

**GO técnico para auditoria independente do P3.** Gates aprovados, defaults preservados e nenhuma regressão persistente confirmada. A divergência transitória da primeira captura normal de 390px está explicitamente registrada. Este veredito não autoriza P4, commit, staging, deploy ou publicação.

Prévia/renderer, mídia resolvida, editor, publicação e validação Cloudflare isolada continuam pendentes. Conteúdo editorial extenso e formatação rica exigem avaliação no futuro consumidor, sem alterar o design por inferência neste checkpoint. As referências PNG são específicas de Windows; outros ambientes requerem referências visuais aprovadas, sem geração automática para obter verde. A certificação pixel a pixel usa Chromium/Windows, fontes locais e estado de movimento explicitamente controlado; não prova equivalência em todos os navegadores/GPU. Sensibilidade local à exaustão de portas continua sem alteração de timeouts.

Nenhum commit, push, PR, merge, rebase, staging, deploy, iframe, endpoint novo, publicação ou P4.

# F4A.4-A — P4: primeira prévia editorial navegável

## Resultado e escopo

**GO para auditoria independente do P4.** Prévia autenticada, somente leitura e navegável demonstrada no Pages local, com todos os gates finais aprovados. Não autoriza publicação, staging ou produção.

Baseline: branch `integration/immersive-cms-f4a`, HEAD `5e9d5863ad00ff7d206e391739d8edb412cc6bfe`, índice vazio. Referências: contratos CMS v2 e relatórios P0–P3. Implementação integrada de shell/iframe, leitura autenticada, renderer, diagnósticos, segurança e testes. Não foram criados checkpoints intermediários de aprovação.

A composição pública de `LandingPage`, seus CSS, contratos comerciais, handlers de escrita CMS, repositório, migrations e publicação permanecem intactos. Não há editor nem operação nova de salvar/publicar/converter no frontend. P5 não iniciado. Nenhum commit, push, merge, rebase, staging ou deploy.

## Executar localmente

No PowerShell, com o Node/dependências já usados pelo projeto:

```powershell
cd C:\Users\zzzzz\dev\chopp-delivery
node tests/e2e-real/demo-preview.mts
```

1. O harness cria um D1 **novo e descartável**, aplica somente as migrations 0001–0009 aprovadas e prepara um documento sintético CMS v2 para demonstração.
2. Abra `http://127.0.0.1:4186/admin` e entre com usuário/senha temporários exibidos **no terminal local**.
3. Abra `http://127.0.0.1:4186/admin/preview`, ou o link **Prévia editorial** do painel. Alterne Desktop/Mobile e navegue pelas seções no frame.
4. Ctrl+C encerra o runtime e remove exclusivamente seu diretório de posse. Uma porta alternativa pode ser passada como argumento: `node tests/e2e-real/demo-preview.mts 4187`.

A demonstração é um harness de teste explícito, fora do bundle. Sua preparação reutiliza `startV2` já existente, com sessão/origem válidas; não adiciona endpoint de escrita e não é executada pelo shell/renderer. Não aceita URL de banco, caminho de persistência ou binding remoto. O catálogo vem das seeds comerciais aprovadas do laboratório; o CMS de demonstração não copia preços/variantes. Não há publicação. O probe de reprodução confirmou schema 2, anônimo 401, autenticado 200, ausência de rascunho no HTML e remoção do diretório ao encerrar (`demo-proof.json`, `demo-probe.log`).

Em um ambiente com rascunho ausente/v1, a UI apresenta instruções para inicialização/conversão explícita pelo fluxo administrativo autorizado. Ela não executa essas operações automaticamente. Os testes conferem estado/revisão antes/depois e ausência de mutações editoriais disparadas pelo documento.

## Arquitetura e reutilização

| Camada | Responsabilidade |
| --- | --- |
| App/AdminApp | Reconhecem somente as rotas novas conhecidas, respeitando ADMIN_ENABLED; modo normal continua sem prévia funcional. LandingPage não recebe CMS. |
| PreviewShell | Sessão F2, toolbar, voltar ao catálogo, atualização, logout, largura real 1440/390px, aviso de rascunho não publicado e estados loading/erro/v1/expiração. |
| PreviewFrame | Documento de navegação próprio, GET autenticado independente e catálogo real; aviso de prévia privada também quando aberto diretamente. |
| usePreviewDocument/model | Estado apenas em memória, response limitada a 150.000 bytes/10s, `cache: no-store`, validação estrita, schema/revisão e `deriveLayout`. |
| PreviewRenderer | Whitelist dos nove templates, ordem/visibilidade/IDs/navegação/números derivados; componentes P3 existentes, sem segunda homepage. |
| Shared validation | Implementações puras existentes movidas para shared; facades compatíveis no servidor; uma fonte de validação para API e cliente. |
| Pages Functions | Verificam sessão real antes de servir o shell estático; headers explícitos por contexto, sem injetar dados privados no HTML. |

Foram reutilizados Hero, BarrelsSection/BarrelCarousel3D, Ticker, CatalogSection, HowItWorks, AboutSection, PromoSection, FaqSection e ContactSection. Props adicionais de apresentação preservam defaults: número, ID de heading de highlights e fallback de mídia. SiteHeader aceita links derivados com default público original. Múltiplos highlights recebem headings únicos a partir do moduleId, sem duplicar IDs. O mapeamento inicio/topo é o já aprovado em deriveLayout. Hero não gera link #barris quando o destino está ausente/oculto.

`CommercialPreviewContext` tem default false. Somente o renderer fornece true: WhatsApp vira botão nativamente disabled, sem href e sem abrir mensagens/avisos comerciais. Navegação interna continua ativa; links externos são bloqueados também na captura de click/auxclick do renderer. O comportamento público não recebe esse provider. Variantes, setas, FAQ e menu continuam interativos apenas em memória.

O catálogo é consultado via useCatalog/API existente. O carrossel obedece à ordem e aos itemIds de entries, selecionando somente chopes visíveis retornados pela API. Item ausente/oculto produz diagnóstico, sem substituir por outro produto. Uma lista vazia permanece vazia. Preços, disponibilidade e volumes não são obtidos do CMS. O catálogo completo e o menor preço do Hero continuam vindo da API; seleção editorial do carrossel não reescreve os produtos do catálogo.

## Validação compartilhada sem servidor no cliente

Movidos para shared: primitives CMS, validation-v1, validation-v2 e unicode-policy. As quatro implementações coincidem literalmente com o baseline após substituir somente caminhos de importação; prova automatizada em `extraction-proof.json`. Os arquivos antigos reexportam as implementações, preservando os consumidores do servidor. Um teste compara identidade da função compartilhada e exportada pelo servidor.

O cliente importa shared diretamente. Não há import de repositório, D1, handlers ou validador localizado em server no renderer/model. Despacho v1/v2, validação estrita de campos/cardinalidades/Unicode/mídia, revisões e regras de publicação não foram relaxados. A prévia só rende schema 2 validado; nulidade/v1 recebe instruções, versões/conteúdo/revisões inválidas falham fechadas. Nenhum conteúdo privado é utilizado como fallback de erro.

## Segurança, sandbox e CSP

Rotas novas: `functions/admin/preview.ts` e `functions/admin/preview/frame.ts`, delegando a `server/cms/preview-page.ts`. Apenas GET/HEAD; outros métodos 405. Cookie inválido, ausência de sessão e token fictício em query não autorizam acesso. As URLs canônicas e com barra final foram testadas. Respostas anônimas são HTML mínimo 401, sem scripts/rascunhos; erros de autenticação indisponível continuam fechados.

O iframe usa `sandbox="allow-scripts allow-same-origin"` para executar os componentes React no viewport próprio e consultar a API de mesma origem com sessão. Essa combinação **não cria uma fronteira de origem**: código da mesma origem pode remover o atributo. As restrições restantes de forms/popups/navegação superior só são defesa adicional enquanto o sandbox é preservado; não protegem contra código hostil da própria aplicação. Esta limitação foi analisada antes da escolha e está alinhada à ressalva da [documentação do iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe). Não se permite HTML/script editorial, srcdoc ou avaliações de código.

As barreiras principais são sessão/autorização server-side nas duas páginas e na API, strict validation/React text escaping, CSP e respostas no-store. O HTML inicial é estático e não contém o documento. Não há documentos em URL, localStorage, sessionStorage, logs ou postMessage; parent e frame fazem GETs independentes. O iframe possui title acessível, sem tokens de acesso em URL.

As novas rotas geradas por Functions enviam os headers diretamente; `_headers` não se aplica automaticamente a respostas de Functions, conforme [Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/headers/). O arquivo público P2 permanece intacto; sua política não foi ampliada para todas as rotas administrativas.

| Resposta | Política |
| --- | --- |
| Shell /admin/preview | `frame-src <origem autenticada>/admin/preview/frame`; `frame-ancestors 'none'`; form-action self. |
| Frame /admin/preview/frame | `frame-src 'none'`; `frame-ancestors 'self'`; form-action none. |
| Ambas | no-store; noindex/nofollow; no-referrer; nosniff; scripts/conexões/fontes self; object/base none; sem unsafe-eval/inline scripts; estilo inline somente conforme necessidade existente; câmera/microfone/geolocalização desabilitados. |

Os E2E confirmam carregamento do frame autorizado, bloqueio CSP de um iframe do parent para /admin (caminho diferente) e bloqueio de frames aninhados no filho. `noindex` não é usado como autorização. Estados de logout removem o frame; revalidação de sessão/resposta ocorre em foco, visibilidade, atualização e a cada 5s. Ocultar a aba limpa o documento da UI. Retomar foco cancela uma leitura anterior para não aguardar uma resposta anterior à revalidação; respostas canceladas/obsoletas não vencem o estado atual. Erro/timeout/documento inválido removem conteúdo. Nenhum timeout de teste foi aumentado.

## Mídia e limites comerciais

Mídia CMS privada vira placeholder, sem resolver URLs/bytes: Hero/About usam fallback de apresentação; entries do carrossel usam fallback por item; highlight mostra reserva de mídia. Imagens públicas originais continuam quando não há mídia privada indicada. `carousel.media` gera somente diagnóstico de função visual ainda indefinida, sem virar imagem geral inventada. Não há endpoint de bytes, binding R2 remoto, alteração de armazenamento ou promessa de integridade/disponibilidade de mídia nesta fase.

Teste no browser simula referências válidas de mídia na resposta autenticada, confirma três placeholders e nenhuma requisição de mídia privada. Essa simulação não é prova de existência/ready de objetos R2: tal processamento não faz parte do P4. Item removido/oculto na resposta comercial é diagnosticado. Variante 1.500 ml mantém 1,5 L e preço da API, com seleção operacional e WhatsApp disabled. Testes anteriores de volumes/variantes continuam íntegros.

## Testes e evidências

| Comando | Exit code | Duração | Evidência |
| --- | --- | --- | --- |
| npm run typecheck | 0 | 1.28s | Aprovado |
| npm run lint | 0 | 0.75s | Aprovado |
| npm test -- --maxWorkers=1 | 0 | 716.67s | 1199 testes / 83 arquivos |
| npm run build | 0 | 2.09s | Aprovado |
| npm run verify:dist | 0 | 0.92s | Aprovado |
| npm run build:release (inclui verify:release) | 0 | 2.56s | release limpo: 8 arquivos, 153 módulos, 124 literais |
| E2E público (public-runner.mjs) | 0 | 28.67s | 63 testes |
| npm run test:e2e:real | 0 | 277.52s | 28 testes |
| npm run test:e2e:release | 0 | 277.56s | 28 testes |

Biome terminou com exit code 0, sem erros, 46 warnings e 16 infos existentes; nenhum fix automático foi aplicado. Logs individuais e `gates.json` registram os comandos e os resultados. Não foram repetidas as suítes finais aprovadas.

Validações focadas durante implementação: 166 casos existentes afetados, 51 casos de modelo/P3, sete E2E P2/P4 e controles adicionais afetados. O modelo novo tem 14 casos: validade/versão/keys/Unicode comercial, vazio/loading/erro, ordem de entries, imutabilidade, navegação oculta, IDs únicos, numeração, mídia e CSP. Cinco cenários E2E P4 cobrem acesso/autorização, ausente/v1, loading, integração visual/navegação, erros/logouts/revogação, catálogo, seleção fracionária e placeholders. Os testes P2 foram adaptados ao novo comportamento autorizado de suas URLs reservadas: 401 sem sessão e frame-ancestors none no shell, mantendo os demais checks. Não foram relaxadas asserções legítimas para obter verde.

As primeiras iterações encontraram asserções antigas incompatíveis (URLs antes eram fallback público, header/hero tinham dois botões de mesmo nome, aria-live sem role=status) e uma corrida real de foco com leitura ativa. As expectativas foram vinculadas ao comportamento correto e a corrida foi corrigida. Um erro de tipagem opcional de IPC no harness foi corrigido antes das suítes finais. Não foram usados skip/fixme/retries ou aumento de timeouts.

Imagens de viewport real foram inspecionadas em Chromium: 1440×900 e 390×900. Fontes, paleta, barris públicos e componentes são os do Conceito C. Evidências em `%TEMP%/chopp-f4a4-a-p4/evidence/`: `preview-desktop.png`, `preview-mobile.png`, `preview-shell.png`. A suíte pública inclui os snapshots DOM/PNG de 390/1440 do P3 com zero tolerância de pixels; as referências não foram atualizadas. A composição pública/CSS existentes conservam SHA-256 inicial.

Logs/JSON de gates, prova de extração e prova de laboratório estão em `%TEMP%/chopp-f4a4-a-p4/`. As suítes finais foram sequenciais; Vitest maxWorkers=1. `build:release` já executa verify:release, sem repetição avulsa desse verificador. O relatório não substitui validação futura em Cloudflare isolado.

## Graphify e impacto

Skill consultada; BFS antes (404 candidatos, 72 exibidos) e DFS depois (228 candidatos, 54 exibidos), no grafo existente de 1552 nós. Logs: `graph-before.log`, `graph-after.log`. As consultas truncadas não foram tratadas como prova exaustiva. Inspeção direta confirmou fluxos App→AdminApp/Frame, sessão→API, modelo→validação shared/deriveLayout, renderer→componentes comerciais e guard HTTP→auth/ASSETS.

O grafo estrutural externo não foi regenerado; portanto não se afirma que contenha os novos nós/arestas do P4. Novas dependências foram conferidas no código e nos grafos reais dos builds/verificadores, com atenção à ausência de server/admin no público e de server/mocks no release. Não foi usado como prova o probe auxiliar da API do compilador, indisponível no TypeScript nativo instalado. As implementações movidas são provadas por comparação literal independente da análise do grafo.

Preservação: 45 arquivos verificados; somente `graphify-out/cache/last_query_stamp` mudou como metadado operacional de consulta. Os outros 44 arquivos são binariamente idênticos ao início. Não houve atualização/regeneração estrutural nem alteração de configurações/hooks.

## Manifesto, preservação e checkpoint

38 arquivos: **18 modificados e 20 novos**. Os novos incluem este relatório.

| Estado | Caminho |
| --- | --- |
| Novo | `docs/immersive-cms-f4a4-a-p4.md` |
| Novo | `functions/admin/preview.ts` |
| Novo | `functions/admin/preview/frame.ts` |
| Novo | `server/cms/preview-page.ts` |
| M | `server/cms/primitives.ts` |
| M | `server/cms/validation-v1.ts` |
| M | `server/cms/validation-v2.ts` |
| M | `server/shared/unicode-policy.ts` |
| Novo | `shared/cms/primitives.ts` |
| Novo | `shared/cms/validation-v1.ts` |
| Novo | `shared/cms/validation-v2.ts` |
| Novo | `shared/preview-security.ts` |
| Novo | `shared/unicode-policy.ts` |
| M | `src/app/App.tsx` |
| M | `src/features/admin/AdminApp.tsx` |
| M | `src/features/admin/AdminHeader.tsx` |
| Novo | `src/features/admin/preview/Preview.module.css` |
| Novo | `src/features/admin/preview/PreviewFrame.tsx` |
| Novo | `src/features/admin/preview/PreviewMessage.tsx` |
| Novo | `src/features/admin/preview/PreviewRenderer.tsx` |
| Novo | `src/features/admin/preview/PreviewShell.tsx` |
| Novo | `src/features/admin/preview/model.test.tsx` |
| Novo | `src/features/admin/preview/model.ts` |
| Novo | `src/features/admin/preview/usePreviewDocument.ts` |
| M | `src/features/catalog/BarrelCarousel3D.tsx` |
| Novo | `src/features/contact/CommercialPreviewContext.ts` |
| M | `src/features/contact/WhatsAppButton.tsx` |
| M | `src/pages/landing/sections/AboutSection.tsx` |
| M | `src/pages/landing/sections/BarrelsSection.tsx` |
| M | `src/pages/landing/sections/CatalogSection.tsx` |
| M | `src/pages/landing/sections/FaqSection.tsx` |
| M | `src/pages/landing/sections/Hero.tsx` |
| M | `src/pages/landing/sections/HowItWorks.tsx` |
| M | `src/pages/landing/sections/PromoSection.tsx` |
| M | `src/pages/landing/sections/SiteHeader.tsx` |
| M | `tests/e2e-real/admin-real.spec.ts` |
| Novo | `tests/e2e-real/demo-preview.mts` |
| Novo | `tests/e2e-real/preview-fixture.ts` |

Manifesto gerado automaticamente: `%TEMP%/chopp-f4a4-a-p4/delivery-manifest.json`, com branch, HEAD, paths, classificação, tamanho e SHA-256 binário. Lista/hashes compatíveis: `delivery-files.txt`, `delivery-hashes.json`. Resultado da recomputação: `manifest-verification.json`. Preservações e migrations: `preservation-final.json`. Os hashes não são transcritos manualmente neste relatório.

Branch/HEAD permanecem no baseline; índice vazio. A correção CP0 e as seis configurações/especificações protegidas conservaram SHA-256. As migrations 0001–0009, LandingPage e todos os CSS preexistentes conservaram SHA-256. Nenhum arquivo externo pertence ao manifesto P4.

Estado final (`git status --short --untracked-files=all`):

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
 M server/cms/primitives.ts
 M server/cms/validation-v1.ts
 M server/cms/validation-v2.ts
 M server/shared/unicode-policy.ts
 M src/app/App.tsx
 M src/features/admin/AdminApp.tsx
 M src/features/admin/AdminHeader.tsx
 M src/features/catalog/BarrelCarousel3D.tsx
 M src/features/contact/WhatsAppButton.tsx
 M src/pages/landing/sections/AboutSection.tsx
 M src/pages/landing/sections/BarrelsSection.tsx
 M src/pages/landing/sections/CatalogSection.tsx
 M src/pages/landing/sections/FaqSection.tsx
 M src/pages/landing/sections/Hero.tsx
 M src/pages/landing/sections/HowItWorks.tsx
 M src/pages/landing/sections/PromoSection.tsx
 M src/pages/landing/sections/SiteHeader.tsx
 M tests/e2e-real/admin-real.spec.ts
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-f4a4-a-p4.md
?? docs/immersive-cms-stage4-spec.md
?? functions/admin/preview.ts
?? functions/admin/preview/frame.ts
?? server/cms/preview-page.ts
?? shared/cms/primitives.ts
?? shared/cms/validation-v1.ts
?? shared/cms/validation-v2.ts
?? shared/preview-security.ts
?? shared/unicode-policy.ts
?? src/features/admin/preview/Preview.module.css
?? src/features/admin/preview/PreviewFrame.tsx
?? src/features/admin/preview/PreviewMessage.tsx
?? src/features/admin/preview/PreviewRenderer.tsx
?? src/features/admin/preview/PreviewShell.tsx
?? src/features/admin/preview/model.test.tsx
?? src/features/admin/preview/model.ts
?? src/features/admin/preview/usePreviewDocument.ts
?? src/features/contact/CommercialPreviewContext.ts
?? tests/e2e-real/demo-preview.mts
?? tests/e2e-real/preview-fixture.ts
```

Riscos residuais: mesma origem não constitui isolamento contra script hostil da aplicação; somente texto estrito e código confiável são aceitos. A revalidação tem intervalo/timeout declarados e não desfaz dados já vistos por usuário anteriormente autorizado. O catálogo é snapshot real ao carregar/atualizar, não estoque em tempo real; a prévia não permite pedidos. Imagens privadas são placeholders, não resolução de mídia. Grafo estrutural histórico, ambiente Chromium/Windows e Cloudflare remoto ainda não validado estão explicitamente limitados. Inicialização/conversão do CMS e editor de escrita continuam fora da prévia. Não iniciar P5, publicação ou deployment com base neste checkpoint.

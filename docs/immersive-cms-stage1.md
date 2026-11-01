# CMS + Immersive Hybrid — Etapa 1: runtime administrativo real

Checkpoint de 01/11/2026. Implementação local, sem commit ou publicação.

## Baselines e escopo

- Branch criada: `integration/immersive-cms-f4a`, a partir de `89fb0951cf5de46a848ad1dbf0a88a8918e5032c`, com working tree inicialmente limpo.
- Referência conferida: `e4fd70e0ae8d8e2a3dde7089126763b8beaa6729`.
- Ancestral conferido: `1d98c48185842f389ec8c5f3af7479283d10e154`.
- Sem merge, cherry-pick, commit, preparação de índice, push ou operação Cloudflare remota.
- Nenhum backend/contrato CMS, mídia, migration 0006/0007, publicação ou editor incorporado.
- Functions, autenticação F2, contratos do catálogo, migrations 0001–0005 e configuração Wrangler permanecem idênticos ao redesign.

## Origem e reconciliação

O snapshot final e4fd70e foi a referência de comparação. Os arquivos administrativos, modos e verificadores foram transportados com seus testes. O runtime e o servidor de E2E usam a versão f062e7e, que corresponde à versão anterior às adições exclusivamente CMS/mídia do snapshot final. Isso evita importar Worker Images, R2, flag de mídia e fixtures CMS proibidos nesta etapa.

O runtime conecta o painel ao gateway HTTP real e à autenticação existente, sem fallback de erro para mock. Foram mantidas as correções de reconciliação de creationRef, conversão para ml após promoção da variante, bloqueio no reducer durante salvamento e proteção estrutural enquanto o resultado é incerto. A recuperação por GET continua anterior à validação de edições posteriores.

Dos seis arquivos sobrepostos entre as linhas, somente vite.config.ts foi alterado nesta etapa: incorpora modos/release/allowlist mantendo a descoberta dos testes TSX do redesign. LandingPage, Hero, Ticker, WhatsAppButton e o E2E público existente não foram substituídos. Não foi necessário importar o anunciante compartilhado de WhatsApp para integrar o runtime.

A suíte real transportada mantém os cenários de sessão, CSRF, concorrência, persistência, resposta perdida, ambiente e porta. As suítes específicas da vitrine anterior, CMS e mídia não foram transportadas; continuam na referência de origem. A única asserção daquele bloco sobre /api/admin/site foi adaptada de 401 para 404 porque o namespace CMS não existe nesta etapa. Nenhuma asserção do catálogo/design existente foi alterada.

Novos E2E verificam preço salvo pelo painel real refletido no carrossel/tabela e mensagem contextual em390/1440px, ausência de rotas/tabelas CMS e controles bloqueados durante PUT pendente.

O verificador transportado considerava translate3d um literal exclusivo do laboratório porque aparece em JSX na prévia de motion. Como o carrossel C usa essa função CSS, o scanner acusava o CSS aprovado. A coleta agora reconhece nomes de funções presentes em CSS público como compartilhados. Grafo/manifest de módulos, fixtures, credenciais e testes de adulteração permanecem ativos. Um teste novo falhou antes da correção e passou depois. Não há allowlist fixa para uma fixture nem retirada de asserções existentes.

Uma edição inicial usou codificação local cp1252 em dois arquivos adaptados; foi corrigida para UTF-8 antes dos resultados finais. As falhas iniciais de tipo/formatação e os ensaios anteriores estão preservados nos logs externos, sem serem contados como aprovação.

## Modos e execução

| Comando/modo | Comportamento |
|---|---|
| npm run dev / build normal | /admin mostra AdminDisabled; painel e mocks não entram no build normal |
| npm run dev:admin:mock | Mock explícito para laboratório, com aviso |
| npm run dev:admin:real | Pages Functions reais, F2, gateway HTTP e D1 descartável na mesma origem |
| npm run build:release | Artefato dist-release com painel HTTP real, verificação própria; não realiza deploy |
| --mode e2e | Preserva laboratório mock dos testes existentes; não publicável |

O runtime cria diretório TEMP exclusivo, marcador de propriedade, D1 e credenciais aleatórias. Não aceita banco do operador. Usa somente migrations0001–0005 no banco descartável; não toca .wrangler/state. Dispose encerra workerd antes de remover o diretório que possui. Falha de posse/caminho impede remoção. Processos filhos recebem ambiente por allowlist, sem tokens/pepper do operador, NODE_OPTIONS ou proxies herdados. A senha de demonstração gerada existe só naquela instância e é exibida pelo comando interativo; não é embutida no frontend.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --maxWorkers=2
npm.cmd run build
npm.cmd run verify:dist
npm.cmd run build:release
# build:release já executa verify:release; execução isolada também está disponível:
npm.cmd run verify:release

$env:CHROMIUM_PATH = 'C:\Users\zzzzz\AppData\Local\ms-playwright\chromium_headless_shell-1243\chrome-headless-shell-win64\chrome-headless-shell.exe'
$env:DELEGAS_INTEGRATION_PORT = '4191'
npm.cmd run test:e2e:real
$env:DELEGAS_INTEGRATION_PORT = '4193'
npm.cmd run test:e2e:release -- --grep 'A/B/M/N|H: real|I/J:|K: uncertain|Etapa 1'
git diff --check
```

Usar executável de Chromium já instalado, ou PLAYWRIGHT_CHANNEL=chrome com CHROMIUM_PATH ausente. Os comandos de teste criam ambientes descartáveis próprios. Não usar dev:full ou db:init no banco mantido para validar esta entrega.

## Resultados finais observados

| Gate | Resultado / exit |
|---|---|
| Typecheck | PASS0 |
| Biome | PASS0,261 arquivos |
| Vitest completo --maxWorkers=2 | PASS0,812/812,55/55 arquivos,136,71s |
| Build normal | PASS0 |
| verify:dist | PASS0,5 arquivos textuais,87 módulos,120 literais |
| Build release + verify:release | PASS0,5 arquivos textuais,135 módulos,124 literais |
| E2E runtime real |16/16 PASS0 em1,8min, mais o novo teste de PUT pendente1/1 PASS0 em6,8s;17 cenários distintos aprovados |
| E2E release direcionado |7/7 PASS0 em46,4s, antes da adição do teste extra de PUT pendente |
| E2E público no Pages emulado |11/12; exit1 por ECONNRESET do APIRequestContext no POST sem corpo, detalhado abaixo |
| Contrato equivalente no Chrome |30/30 respostas corretas (dez sequências GET/PUT/POST), catálogo intacto, exit0 |
| Visual Chromium390/768/1280/1440 |12/12 PNGs de Hero/carrossel/catálogo binariamente idênticos às capturas da consolidação; sem overflow horizontal medido |
| Diff de landing/catálogo/contato/FAQ/estilos/assets/backend/migrations | Vazio em relação a89fb095 |
| git diff --check | PASS0 |

Não se declara todos os E2E verdes. Os resultados16+1 foram execuções separadas; a suíte completa atual contém17 testes. O Vitest completo foi repetido após a correção do verificador; depois disso a única alteração de código de teste foi o E2E adicional, executado isoladamente. Typecheck/lint foram repetidos no fechamento.

## Pendência do cliente HTTP no emulador

A suíte pública usa APIRequestContext e presume401/503 para chamadas sem sessão. Com configuração F2 real, PUT sem Origin corretamente retorna403 antes da consulta de sessão; o harness temporário fornece Origin válido para exercitar a rejeição por sessão. As expectativas do arquivo de teste não foram modificadas.

Após essa adequação do contexto, o POST sem corpo para /api/admin/catalog/v2 recebe read ECONNRESET no APIRequestContext. Connection:close não resolveu. Não foram adicionados retries, aumentados timeouts ou removidas asserções. A causa interna do reset não foi estabelecida.

No mesmo runtime, Chrome fetch executou dez sequências reais: GET401/UNAUTHENTICATED, PUT401/UNAUTHENTICATED e POST405/Allow:GET, PUT, preservando o catálogo integral. Uma sondagem APIRequestContext após esse controle reproduziu o reset. Isso delimita a diferença observada entre transportes, sem provar que seja problema exclusivo do Playwright nem certificar comportamento remoto.

A limitação permanece aberta para auditoria. O arquivo público original e sua expectativa405 foram preservados. Não foi alterado handler, guard ou comportamento de produção para contornar o erro. Não há autorização de publicação, nem aceite irrestrito enquanto a ressalva não for avaliada.

## Evidências externas e checkpoint

Artefatos em %TEMP%/chopp-stage1: origins.json, vitest-final.log, guard-red.log, guard-green-final.log, build-final.log, verify-dist-final.log, build-release-final.log, e2e-real-final.log, e2e-saving.log, e2e-release.log, public-visual-final.log, public-visual-close.log, diagnostic-visual.log, transport-diagnostic.json, visual-comparison.json e screenshots react-*.png. Há também scripts temporários e configuração de ensaio para reprodução da limitação; não são entregues no bundle nem preparados para commit.

O baseline visual usado é o conjunto validado na consolidação local anterior, capturado do mesmo redesign aprovado; não é uma nova declaração de equivalência pixel a pixel com o HTML do estúdio.

Checkpoint: Etapa1 implementada e disponível para auditoria independente, com ressalva explícita de transporte local. Runtime, isolamento e preservação do Conceito C têm evidência positiva. Não representa GO irrestrito de todos os gates, aprovação de commit ou autorização para avançar ao backend CMS, mídia, publicação ou editor.

## Inventário da entrega

Todos os arquivos alterados/novos, incluindo este documento:

- `.gitignore`
- `docs/immersive-cms-stage1.md`
- `package.json`
- `playwright.real.config.ts`
- `playwright.release.config.ts`
- `scripts/bundle-guard.d.mts`
- `scripts/bundle-guard.mjs`
- `scripts/check-public-bundle.mjs`
- `scripts/check-release-bundle.mjs`
- `scripts/clean-env.mts`
- `scripts/dev-admin-integration.mts`
- `scripts/integration-port.mts`
- `src/app/App.tsx`
- `src/features/admin/AdminApp.tsx`
- `src/features/admin/AdminDisabled.tsx`
- `src/features/admin/catalog/CatalogView.module.css`
- `src/features/admin/catalog/CatalogView.tsx`
- `src/features/admin/catalog/ItemCard.tsx`
- `src/features/admin/catalog/draft.ts`
- `src/features/admin/catalog/httpGateway.ts`
- `src/features/admin/catalog/useCatalogEditor.ts`
- `src/features/admin/ui/TextField.tsx`
- `tests/backend/admin-integration-runtime.test.ts`
- `tests/backend/admin-panel-integration.test.ts`
- `tests/e2e-real/admin-real.spec.ts`
- `tests/e2e-real/server.mts`
- `tests/frontend/admin-gateway-boundary.test.ts`
- `tests/frontend/admin-production-gate.test.ts`
- `tests/frontend/bundle-guard.test.ts`
- `tests/frontend/clean-env.test.ts`
- `tests/frontend/integration-port.test.ts`
- `tests/frontend/release-bundle.test.ts`
- `tsconfig.backend.json`
- `vite.config.ts`

Arquivos transportados por origem:

- `src/app/App.tsx` — `e4fd70e`
- `src/features/admin/AdminApp.tsx` — `e4fd70e`
- `src/features/admin/AdminDisabled.tsx` — `e4fd70e`
- `src/features/admin/catalog/CatalogView.module.css` — `e4fd70e`
- `src/features/admin/catalog/CatalogView.tsx` — `e4fd70e`
- `src/features/admin/catalog/ItemCard.tsx` — `e4fd70e`
- `src/features/admin/catalog/draft.ts` — `e4fd70e`
- `src/features/admin/catalog/httpGateway.ts` — `e4fd70e`
- `src/features/admin/catalog/useCatalogEditor.ts` — `e4fd70e`
- `src/features/admin/ui/TextField.tsx` — `e4fd70e`
- `scripts/bundle-guard.d.mts` — `e4fd70e`
- `scripts/bundle-guard.mjs` — `e4fd70e`
- `scripts/check-public-bundle.mjs` — `e4fd70e`
- `scripts/check-release-bundle.mjs` — `e4fd70e`
- `scripts/clean-env.mts` — `e4fd70e`
- `scripts/integration-port.mts` — `e4fd70e`
- `playwright.real.config.ts` — `e4fd70e`
- `playwright.release.config.ts` — `e4fd70e`
- `tests/backend/admin-integration-runtime.test.ts` — `e4fd70e`
- `tests/backend/admin-panel-integration.test.ts` — `e4fd70e`
- `tests/frontend/admin-gateway-boundary.test.ts` — `e4fd70e`
- `tests/frontend/admin-production-gate.test.ts` — `e4fd70e`
- `tests/frontend/bundle-guard.test.ts` — `e4fd70e`
- `tests/frontend/clean-env.test.ts` — `e4fd70e`
- `tests/frontend/integration-port.test.ts` — `e4fd70e`
- `tests/frontend/release-bundle.test.ts` — `e4fd70e`
- `tsconfig.backend.json` — `e4fd70e`
- `scripts/dev-admin-integration.mts` — `f062e7e` — Stage 1 runtime before CMS/media-only additions in final snapshot
- `tests/e2e-real/server.mts` — `f062e7e` — Stage 1 runtime before CMS/media-only additions in final snapshot
- `tests/e2e-real/admin-real.spec.ts` — `e4fd70e` — Real runtime/auth/save/release/environment/port cases; no legacy-storefront/CMS/media suites


## Resolução final do ECONNRESET — 01/11/2026

Este adendo atualiza o checkpoint anterior. O bloqueador de transporte foi resolvido pela alternativa B, exclusivamente no harness. O aceite global para consolidação continua NO-GO porque a execução pública completa revelou três testes legados incompatíveis com o Conceito C já consolidado. Não foram alterados nesta rodada.

### Causa demonstrada e alcance

As Functions atuais foram compiladas para TEMP, sem modificar fontes de servidor. Os experimentos usaram Miniflare descartável, sem schema comercial e sem aplicar migrations: a chamada sem cookie retorna401 antes de qualquer consulta ao catálogo. Foram comparados o Worker sozinho e o mesmo Worker com a configuração de roteamento de assets utilizada pelo runtime Pages.

No modo Pages com assets, PUT sem sessão e com JSON retornou401; o POST subsequente no mesmo APIRequestContext reutilizou a conexão e recebeu ECONNRESET. A captura TCP sem alterar bytes registrou, por exemplo, conexão4/porta60339: PUT com Content-Length78 e Connection:keep-alive; resposta401 com JSON, no-store, nosniff, DENY e transferência chunked/gzip; POST na mesma conexão com Content-Length0; reset do upstream sem resposta405. A execução direta, sem proxy de observação, reproduziu read ECONNRESET.

Na alternativa B, o PUT usou conexão5/porta60341 e o POST usou conexão6/porta60343; o POST respondeu405, Allow:GET, PUT e os mesmos headers de segurança. Dez pares adicionais reproduziram dez falhas com contexto reutilizado e dez sucessos com contexto independente. Não houve retry por falha. POST isolado, GET401 seguido de POST e PUT401 sem corpo seguido de POST também responderam405. O Worker sem roteamento de assets não reproduziu o reset, mesmo mantendo os handlers.

Isso demonstra uma interação de ciclo de conexão do Pages emulado com rejeição antecipada de corpo não lido e reutilização do contexto. Não identifica a linha interna responsável no emulador, não prova comportamento remoto e não autoriza afirmar que qualquer cliente HTTP esteja imune. O resultado anterior de Chrome30/30 permanece como controle adicional. Nenhum defeito de semântica/autorização dos handlers foi demonstrado.

### Comparação A/B

| Variante experimental | JSON pequeno e POST no mesmo contexto | Corpo grande / cliente lento | Decisão |
|---|---|---|---|
| Não consumir |401 seguido de reset com assets | Rejeição401 imediata; corpo grande também provoca reset subsequente | Manter política do servidor; isolar o teste de método |
| Consumir integralmente antes de devolver401 | POST405 | Consumiu262190 bytes não autorizados; cliente lento não recebeu resposta antes do watchdog experimental de812ms | Não adotar: custo e atraso desnecessários antes da rejeição |
| request.body.cancel() | Reset persistiu com assets | Cliente lento rejeitado rapidamente; não preservou reutilização | Não adotar |
| Consumo limitado a128KiB/200ms | POST405 para corpo pequeno | Limite de bytes/cancelamento voltou a produzir reset no caso grande; cliente lento recebeu401 em215ms | Não adotar: amplia superfície/custo e não resolve todos os casos |
| Contexto independente para POST |405 e Allow corretos | Não acrescenta leitura de corpo ao servidor | Adotada |

Os limites e tempos acima são parâmetros do experimento, não novas regras da aplicação. A leitura limitada pode receber um chunk que ultrapasse o teto antes de cancelar; não se presume limite exato de alocação pelo simples contador de bytes. A política real de128KiB, a autenticação e o CSRF não foram alterados.

### Alteração mínima adotada

- e2e/catalog-expansion.spec.ts: o PUT usa Origin de mesma origem para testar rejeição por sessão, sem confundir com403 de CSRF. O teste de método e a conferência final do catálogo usam APIRequestContext próprio, descartado em finally. Mantidos405 e Allow:GET, PUT, além de401/503 de falha fechada. POST com maxRetries0 explícito. Não se tenta novamente uma requisição que falhou.
- tests/e2e-real/admin-real.spec.ts: acrescentada regressão em runtime real verificando PUT401/UNAUTHENTICATED, POST405/Allow em contexto independente, catálogo integral preservado e Origin inválida403/INVALID_ORIGIN.
- Este documento: diagnóstico, resultados e decisão de não preparar o índice.

Nenhuma alteração em server/, functions/, shared/, migrations/, landing, catálogo, contato, FAQ, estilos ou imagens. Nenhuma mudança de autenticação, limites, semântica401/403/405 ou Conceito C.

### Revalidação completa

| Gate / comando | Resultado final |
|---|---|
| npm run typecheck | PASS, exit0 |
| npm run lint | PASS, exit0,261 arquivos |
| npm test -- --maxWorkers=2 | PASS, exit0,812/812 em55 arquivos,132,99s na execução isolada |
| npm run build | PASS, exit0 |
| npm run verify:dist | PASS, exit0,87 módulos/120 literais |
| npm run build:release, que inclui verify:release | PASS, exit0,135 módulos/124 literais |
| npm run test:e2e:real, porta4213 | PASS, exit0,18/18 |
| npm run test:e2e:release, porta4214 | PASS, exit0,18/18, suíte inteira sem grep |
| Suíte pública completa no Pages descartável, retries0 |54/57, exit1; sem ECONNRESET; nenhuma falha de catálogo, rotas, autenticação ou contexto independente |
| git diff --check | PASS, exit0 |

A suíte pública completa incluiu landing, motion, catálogo, rotas gerais, auth e rotas administrativas sem sessão. O harness está em %TEMP%/chopp-econnreset-final/public.config.mjs e public-runner.mjs; as expectativas de landing/motion não foram alteradas. Todas as12 verificações direcionadas do catálogo passaram dentro dessa execução, assim como as demais rotas públicas.

A primeira execução de Vitest, concorrente com E2E, terminou811/812: o teste que compara o conjunto global de diretórios TEMP encontrou três diretórios legítimos criados pelos outros runtimes. A repetição foi feita após encerrá-los, sem editar teste ou timeout, passando812/812. Essa dependência de exclusividade do teste de limpeza deve orientar a ordem dos comandos; não foi corrigida fora do escopo.

Os testes existentes inicializam somente suas fixtures descartáveis, incluindo o schema necessário ao runtime. Não houve comando de migração operacional, nova migration ou aplicação de schema ao banco mantido/local do operador ou a banco remoto.

### Três falhas legadas, reproduzidas no baseline

1. e2e/landing.spec.ts:99 exige quatro linhas com as palavras Chope / gelado / na / porta. O Conceito C usa outro headline.
2. e2e/landing.spec.ts:131 mede posições de nós do título antigo; não corresponde aos nós do título C.
3. e2e/motion-system.spec.ts:133 exige zero imagens dentro do Hero; o Hero cinematográfico aprovado possui uma imagem.

Esses arquivos e o Hero estão idênticos ao HEAD89fb095. Para controle independente, o frontend desse commit foi recomposto em memória no build Vite para TEMP, sem checkout, usando o catálogo histórico exclusivamente como fixture visual. Os mesmos três testes falharam nas mesmas asserções de título/imagem. O primeiro ensaio desse servidor de controle teve erro de normalização de caminhos Windows e não foi usado como evidência; baseline-proof-final.log e baseline-results.json contêm a execução válida. Esse controle não é uma prova de API/D1.

Não foi alterada nenhuma expectativa apenas para obter aprovação e não foi modificado o design para atender testes do layout anterior. Resolver a incompatibilidade de especificação desses três testes exige uma rodada autorizada separada.

### Manifesto e consolidação

Os34 caminhos da entrega anterior continuam presentes. Há um único caminho adicional: e2e/catalog-expansion.spec.ts, autorizado para a solução B. O novo teste e este adendo modificam arquivos já pertencentes ao manifesto. Total candidato:35 arquivos (18 rastreados modificados e17 novos).

Como o gate público completo não passou, a condição de preparação do commit não foi satisfeita. Índice mantido vazio; nenhum git add, commit, push, merge, staging Cloudflare ou deploy. O diff de trabalho foi revisado, mas não existe diff preparado para revisar. O manifesto e hashes de entrega estão em %TEMP%/chopp-econnreset-final.

Veredito: GO para a correção específica do ECONNRESET; NO-GO para consolidação local neste checkpoint, exclusivamente pela falta de aprovação integral dos E2E públicos. Não avançar de fase.

### Evidências e reprodução

%TEMP%/chopp-econnreset-final contém experiments-final.mjs/json/log (alternativas A/B, headers e conexões), experiments-pages.log, public-results.json, public-summary.json, public.log, baseline-proof-final.log, baseline-results.json, vitest-isolated.log, e2e-real.log, e2e-release.log, build.log, verify-dist.log, release.log, initial-files.txt e initial-hashes.json. O experimento usa compilação das Functions em TEMP; não é código transportado para produção.


## Atualização dos três E2E legados — checkpoint final de 01/11/2026

Este adendo substitui o NO-GO do checkpoint anterior: as três expectativas legadas foram substituídas por garantias comportamentais do Conceito C e todos os gates solicitados passaram. GO técnico para commit local controlado. Não houve commit, preparação de índice, push, merge ou publicação nesta rodada.

### Expectativas antigas, substituições e controles negativos

| Teste original | Incompatibilidade | Garantia atual | Defeito simulado detectado |
|---|---|---|---|
| landing.spec.ts:99, quatro linhas e palavras Chope/gelado/na/porta | Headline e estrutura anteriores ao C; quebra atual é fluida | Hero com região nomeada, único H1 com headline C, H2 dos barris, imagem carregada com alt, CTAs corretos, selos e preço mínimo derivado da API; recortes de texto/controles/imagem e sobreposições medidos em768/1280/1440px | M1: H1 com height8px/overflow:hidden. O texto ainda existe e o elemento é visível, mas a asserção de recorte detecta os dois trechos cortados. |
| landing.spec.ts:131, na porta na mesma linha | Os nós do título anterior não representam o C | Conteúdo/imagem/CTAs íntegros em360/390/412px, sem impor número de linhas; navegação efetiva para os barris | M2: abortar a imagem do Hero no navegador. naturalWidth0 reprova, mesmo quando alt e caixa do img permanecem presentes. |
| motion-system.spec.ts:133, zero imagens no Hero | O C aprovado tem imagem legítima de barril | Imagem carregada, sem logo no background; reduced-motion sem transição/zoom não essencial ou animações em execução; estabilidade geométrica e navegação por teclado com foco visível em390/1440px | M3: animação infinita de opacidade injetada somente sob reduced-motion. getAnimations identifica1 animação em vez de0. |

Os três testes foram substituídos, não removidos. Nenhum skip/fixme, retry ou relaxamento de expectativa foi utilizado. Os seletores principais usam region/heading/link/button/img e nomes acessíveis, sem classes geradas de CSS ou contagem fixa de linhas. O helper geométrico usa tags semânticas e Range.getClientRects; compara com ancestrais que efetivamente recortam e detecta interseções entre headline, CTAs e imagem. A sobreposição intencional da legenda flutuante sobre a imagem não é tratada como erro.

Os controles negativos foram executados no runtime real descartável, usando cópias dos testes em TEMP e alteração apenas de DOM/rede do navegador. Cada mutante teve exatamente um teste selecionado e uma falha de asserção relevante, exit1; o harness encerrou com exit0 após comprovar3/3 detectados. Não se contou erro de importação como detecção: a primeira tentativa do harness temporário precisou ajustar a resolução do Playwright e foi descartada da evidência válida.

### Regressão real de movimento reduzido e correção mínima

A primeira execução dos três testes atualizados passou nos dois casos de layout e falhou no motion: em reduced-motion, a imagem mantinha transitionDuration0.7s e o zoom de hover do C. Essa evidência está em three-red.log. A exceção autorizada para defeito real de produção foi aplicada somente a Hero.module.css: dez linhas acrescentam @media(prefers-reduced-motion:reduce), transition:none na imagem e transform:none no hover. Paleta, layout, tipografia, assets, React, dados e comportamento visual normal permanecem inalterados.

Após a correção, os três casos passaram (three-green.log,3/3). M3 também comprova que essa passagem não decorre de ignorar movimento reduzido. Nenhum outro componente de produção foi alterado.

### Validações finais desta rodada

| Gate | Resultado / exit |
|---|---|
| Três testes substitutos, --grep Hero C |3/3 PASS, exit0 |
| Mutantes de clipping, imagem quebrada e movimento indevido |3/3 detectados; cada teste exit1 esperado; harness exit0 |
| npm run typecheck | PASS, exit0 |
| npm run lint | PASS, exit0;261 arquivos; sem warnings no fechamento |
| npm test -- --maxWorkers=2 |812/812 em55 arquivos; exit0;125,18s |
| npm run build | PASS, exit0 |
| npm run verify:dist | PASS, exit0;87 módulos,120 literais de laboratório |
| npm run build:release, incluindo verify:release | PASS, exit0;135 módulos,124 literais |
| E2E público completo |57/57 PASS; exit0;10,4s; zero skipped/flaky/unexpected |
| npm run test:e2e:real, porta4213 |18/18 PASS; exit0;1,9min |
| npm run test:e2e:release, porta4214, sem grep |18/18 PASS; exit0;1,9min |
| git diff --check | PASS, exit0 |

O Vitest foi concluído sem E2E concorrentes para preservar a precondição do teste de limpeza global de TEMP. Depois foram executados os E2E em runtimes e portas separados. A suíte pública usa public.config.mjs e public-runner.mjs em TEMP, abrangendo landing, motion, catálogo, rotas, autenticação e rotas administrativas sem sessão. A correção de contexto independente do POST e as expectativas401/403/405/Allow permaneceram intactas; o cenário do ECONNRESET passou nas suítes pública, administrativa e release.

Os builds usam os comandos normais do repositório; não houve publicação. A inicialização de schema ficou nas fixtures descartáveis já previstas pelos testes: nenhuma migration nova ou aplicação a banco mantido/local do operador ou remoto.

### Diff, manifesto e estado Git

Os35 arquivos candidatos anteriores foram preservados. Foram acrescentados ao conjunto somente e2e/landing.spec.ts, e2e/motion-system.spec.ts e Hero.module.css, este último por regressão real comprovada. O documento de checkpoint já pertencia aos35 e recebeu este adendo. Total:38 candidatos,21 arquivos rastreados modificados e17 novos.

Diff desta rodada (sem recontar a implementação administrativa anterior): landing.spec.ts +121/-36; motion-system.spec.ts +58/-24; Hero.module.css +10/-0; documentação neste arquivo. Patch legível em %TEMP%/chopp-legacy-e2e/changes.patch. Não há arquivos temporários ou mutantes no manifesto.

Branch integration/immersive-cms-f4a; HEAD89fb0951cf5de46a848ad1dbf0a88a8918e5032c. Índice vazio, nenhum commit criado. Contratos, Functions, autenticação, catálogo, migrations, mídias e dados comerciais não foram alterados. O único delta adicional de produção nesta rodada é a media query de acessibilidade comprovada acima.

Manifesto e hashes: %TEMP%/chopp-legacy-e2e/delivery-files.txt e delivery-hashes.json. Origem dos35 candidatos anteriores permanece documentada nos adendos e inventários anteriores.

### Evidências de auditoria

%TEMP%/chopp-legacy-e2e contém three-red.log, three-green.log, mutation-results.json, mutation-summary.json, M1/M2/M3*.json/log, mutations-final.log, public-results.json, public.log, vitest.log, e2e-real.log, e2e-release.log, build.log, verify-dist.log, release.log, changes.patch, reference-files.txt e reference-hashes.json. Os scripts de reprodução e cópias mutadas também ficam exclusivamente nesse TEMP.

Veredito atual: GO técnico para um futuro commit local controlado dos38 candidatos, sujeito à revisão do manifesto no momento da preparação. Não autoriza staging Cloudflare, produção, próxima fase ou publicação remota. A auditoria não equivale a ensaio em dispositivos físicos ou homologação remota Cloudflare.

Nota de integridade do inventário: a conferência dos35 candidatos usa o manifesto e os hashes do checkpoint anterior, copiados como reference-files.txt/reference-hashes.json. A captura preliminar inicial desta rodada usou o diretório padrão incorreto e foi descartada como evidência; não houve alteração naquele projeto. O manifesto final foi validado no diretório correto do Chopp Delivery.

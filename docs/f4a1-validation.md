# F4A.1 — resultados locais para auditoria

Execução de 15/10/2026, no worktree
`C:\Users\zZzZz\Projetos\chopp-delivery-integration`.
Branch `integration/delegas-f3`, base/HEAD preservado
`fc5bc3052c114bb07f2c742ae2a4321f47f8894c`.
Preflight confirmou branch, HEAD, staging vazio e worktree limpo.

## Resultados

| Gate | Resultado |
| --- | --- |
| Hardening P2/P3 inicial, antes da correção | 12 falhas / 12 aprovados: reprodução de pontuação, controles de linha única e objeto materializado divergente |
| Regressões adicionais da revisão, antes do ajuste final | 4 falhas / 24 aprovados: 3 URIs fragmentadas e 1 contraexemplo editorial |
| Testes CMS finais direcionados | **127/127**, 8 arquivos; 13,77 s |
| Vitest completo final, `npm.cmd test -- --maxWorkers=2` | **1.137/1.137**, 69 arquivos; 149,60 s; exit 0 |
| Integração D1 | Incluída nos testes CMS e no Vitest: Miniflare sem persistência, migrations Wrangler em TEMP e Pages reais |
| E2E novo CMS isolado, Chrome | **1/1**, 7,7 s; Pages Functions e D1 reais locais descartáveis |
| E2E administrativos completos, release/Chrome | **22/22**, 2,7 min; versão final do teste, exit 0 |
| E2E administrativos completos, integração/Chrome | **22/22**, 2,7 min; versão final do teste, exit 0 |
| Typecheck frontend/backend | Passou; repetido nos dois builds após o último ajuste de runtime |
| Biome, `npm.cmd run lint` | **295 arquivos**, sem erros/avisos/informações pendentes |
| Build normal + verify:dist | Passaram: 5 arquivos, 89 módulos, 129 literais verificados |
| Build release + verify:release explícito | Passaram: 5 arquivos, 137 módulos, 133 literais verificados |
| npm audit --json | **Zero vulnerabilidades** em todos os níveis; 202 dependências no relatório |
| git diff --check, incluindo arquivos novos em comparação separada | Passou; 20 arquivos conferidos, staging vazio |

Os 58 testes novos estão incluídos nos 1.137; os 27 cenários do script de mídia
estão dentro de um teste Vitest e não devem ser somados novamente. Os testes CMS
incluem os 69 testes anteriores. Não houve redução de asserções/timeouts. A execução
com dois workers segue o controle de concorrência local já usado na L0A.1/L0A.2.
Nenhuma dependência, lockfile, configuração de build/Playwright ou binding foi alterado.

Os builds normal/release continuam com os mesmos módulos frontend: nenhuma interface
CMS foi adicionada. A única expectativa E2E anterior alterada é `/api/admin/site`
sem sessão: antes 404 por ausência de rota; agora 401 por autenticação real.
Isso acompanha a rota autorizada na F4A.1, sem enfraquecer a proteção de acesso.

## Evidências observáveis no D1

- Estado inicial sem documento/versão/ref/mídia e sem conteúdo publicado. GETs
  repetidos preservam a linha cms_state e a contagem de versões.
- Duas gravações válidas guardam duas versões imutáveis e dados anteriores intactos;
  UPDATE/DELETE de versão falham. Tokens mudam e o ponteiro público permanece null.
- Duas intenções concorrentes na mesma revisão: exatamente 200/409, uma versão.
  Mesmo comando concorrente: 200/200 com recibos iguais e uma única versão.
- Replay com chaves de envelope reordenadas e replay depois de revisão posterior
  recuperam o recibo original; conteúdo diferente com o mesmo ID conflita sem gravar.
- Revogação, inativação, mudança de auth_version, expiração e origem alterada entre
  guard e batch: 401, nenhuma versão/ref e revisão preservada. Revogação dentro do
  trigger também aborta e reverte todas as alterações daquele statement.
- Falhas ABORT/IGNORE na versão, refs ou estado e referência extra injetada: nenhuma
  gravação parcial. As assertivas conferem dados persistidos, não apenas status.
- Mídia inexistente/deleting é recusada; referências duplicadas são deduplicadas e
  as ocultas são preservadas. FK/guard impedem remover mídia referenciada.
- Schema parcial/histórico 0006 ausente falha fechado. Publicação direta no SQL
  é bloqueada pelos guards desta fase.
- Catálogo completo antes/depois: produtos legados, cachaça legada, categorias,
  itens, variantes, centavos, volumes, visibilidade/disponibilidade e revisão iguais.
  A migration 0006 também preserva schema e dados de todos os objetos preexistentes.

O novo E2E usa cookie real obtido por login no Chrome, intercepta e perde a resposta
de uma gravação já concluída, recupera o recibo pela rota real, repete a operação,
confere conflito/CSRF/401 em contexto sem sessão e verifica diretamente SQLite e o
JSON público do catálogo. Rotas publish/media continuam 404. Não usa mock CMS.

## Falhas encontradas e correções

1. Os testes RED de hardening reproduziram os itens da auditoria antes de integrar
   os validadores à API. Corrigidos sem trocar as expectativas de segurança.
2. TypeScript apontou linhas D1 inferidas como unknown; os batches passaram a usar
   o tipo de linha explícito, com validação dos campos lidos. Biome corrigiu estilo
   e organização dos arquivos novos, sem suppressions/configuração relaxada.
3. A primeira seleção do teste de isolamento excluía nomes cms_, mas ainda incluía
   sqlite_autoindex_cms_*. O teste foi corrigido para excluir também objetos cujo
   tbl_name pertence ao CMS, mantendo comparação exata do schema preexistente e
   dos dados comerciais. Isso não exigiu alteração da migration.
4. A revisão adversarial interna encontrou TAB/CR/LF em esquemas perigosos de
   campos multilinha. Três regressões e o contraexemplo `Metadata:` falharam;
   normalização exclusiva do detector e fronteira de palavra corrigiram os casos.
5. A execução completa preliminar terminou com **1.133 aprovados e 4 falhas**, nos
   quatro casos RED acrescentados durante essa revisão (69 arquivos, 149,44 s).
   O fechamento foi repetido após a correção: **1.137/1.137**. Essa falha não foi
   atribuída a intermitência; o código tinha um caso de validação a corrigir.

6. As primeiras suítes E2E completas de release e integração tiveram cada uma
   **21 aprovados / 1 falha** (2,8 min e 2,7 min), ambas ECONNRESET no POST à rota
   de mídia inexistente. O cenário isolado passou em integração (1/1, 7,7 s) e
   release (1/1, 7,5 s). Isso motivou diagnóstico, sem aumentar timeouts/retries.
   No Pages local, 30 pares PUT/POST com APIRequestContext tiveram 29 falhas no
   transporte padrão; Connection: close não resolveu (30 falhas/30). Um Worker
   mínimo passou 10 POSTs com resposta precoce e 10 consumindo corpo, de modo que
   não se atribuiu o problema genericamente a corpo não lido ou keep-alive.
   Um controle em Chrome executou os mesmos tipos de PUT/POST em rotas ausentes:
   **40 respostas 404/40 requisições, zero erros**. Os dois asserts negativos do
   E2E passaram a usar fetch do Chrome, com verbos, corpos e duas asserções 404
   preservados. Nenhum handler/fallback de produção foi alterado. A causa interna
   completa do reset APIRequestContext/Pages local permanece não demonstrada;
   não se declara o transporte remoto corrigido ou comprovado por isso.

Avisos npm em
stderr podem aparecer no PowerShell como NativeCommandError mesmo com exit 0;
foram considerados códigos de saída e resumos dos runners. Warnings NO_COLOR /
FORCE_COLOR no runner não alteraram testes. Git na sessão restrita pode avisar
sobre ignore global sem leitura; status/diffs do projeto foram conferidos.

## Inventário — 20 arquivos

Modificados (5):

- `server/cms/validation.ts` — P2/P3, materialização e limite do envelope.
- `shared/cms.ts` — estado inicial com documento null e recibo administrativo tipado.
- `scripts/media-proof.mjs` — percurso JPEG por segmentos/scans e quatro regressões.
- `tests/backend/cms-media-proof.test.ts` — exige os 27 cenários, preservando anteriores.
- `tests/e2e-real/admin-real.spec.ts` — 401 da rota criada e novo cenário CMS real.

Novos (15):

- `migrations/0006_cms_foundation.sql`.
- `server/cms/repository.ts`, `server/cms/http.ts`, `server/cms/handlers.ts`.
- `functions/api/admin/site.ts`, `functions/api/admin/site/draft.ts`,
  `functions/api/admin/site/commands/[id].ts`.
- `tests/backend/cms-document-fixture.ts`, `tests/backend/cms-fixture.ts`.
- `tests/backend/cms-hardening.test.ts`, `tests/backend/cms-api.test.ts`,
  `tests/backend/cms-http.test.ts`, `tests/backend/cms-schema.test.ts`.
- `docs/cms-backend-local.md`, `docs/f4a1-validation.md`.

Migrations 0001–0005, autenticação F2, handlers/contratos de catálogo, frontend,
layout/textos comerciais, package.json, lockfile e wrangler.jsonc intactos.

## Estado Git, limitações e recomendação

HEAD e branch preservados; **5 arquivos rastreados modificados e 15 novos**, todos
fora do staging. Nenhuma outra alteração rastreada. Sem staging, commit, push,
merge, rebase, deploy ou operação remota Cloudflare/D1. Migrations ensaiadas somente
em instâncias locais descartáveis; nenhum banco mantido foi migrado.

Contratos/algoritmo SQL e HTTP tiveram revisão adversarial interna com contexto
isolado; um achado de URI foi classificado como acionável e corrigido com RED/GREEN.
Isso não substitui a auditoria independente do Antigravity. Não houve revisão por
outro modelo nem execução de CLI de modelo externo.

Persistem limites de infraestrutura remota/quotas/latência e a falta de prova remota
Cloudflare de mídia e a limitação APIRequestContext/Pages descrita acima. O laboratório native sharp/Miniflare não é um pipeline de
produção. Não há GC/retentiva de versões; crescimento do histórico e eventual
política de descarte exigem fase própria. O filtro de texto é conservador, não uma
garantia completa de conformidade; futuro renderer ainda deve tratar texto como
inerte. Acesso arbitrário de operador ao schema não é isolado pelos guards SQL.

**Recomendação: GO para auditoria independente da F4A.1.**
Não é GO para commit, publicação, upload ou deploy. Aguardar Antigravity e autorização
explícita antes de qualquer consolidação.

Detalhes de endpoints/schema/invariantes: [cms-backend-local.md](cms-backend-local.md).
Logs em `%TEMP%`: `delegas-f4a1-vitest.log`, `delegas-f4a1-vitest-final.log`,
`delegas-f4a1-e2e-cms.log`, `delegas-f4a1-e2e-release.log`,
`delegas-f4a1-e2e-release-isolated.log`, `delegas-f4a1-e2e-release-final.log`,
`delegas-f4a1-e2e-real.log`, `delegas-f4a1-e2e-real-final.log`,
`delegas-f4a1-http-diagnostic.log`, `delegas-f4a1-route-diagnostic.log`,
`delegas-f4a1-browser-diagnostic.log`, `delegas-f4a1-build.log`,
`delegas-f4a1-build-release.log` e `delegas-f4a1-audit.json`.
Manifesto externo de hashes dos 20 arquivos: `%TEMP%/delegas-f4a1-delivery-sha256.json`.

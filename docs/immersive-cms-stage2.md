# CMS + Immersive Hybrid — Etapa 2

Checkpoint de 01/11/2026. Implementação local para auditoria, sem commit.

## Baseline e origem

- Branch: `integration/immersive-cms-f4a`.
- Baseline: `11df9c81aa05ae71a7f29a7a3bb135f8a5fb73bd`; HEAD, índice vazio e working tree limpo confirmados antes da implementação.
- Contratos iniciais: `fc5bc3052c114bb07f2c742ae2a4321f47f8894c`.
- Snapshot transportado: `f44b19668eabdfa0d9a4e0c4da49db558406479d`, que inclui o hardening posterior de validação e persistência.
- `e4fd70e0ae8d8e2a3dde7089126763b8beaa6729` foi somente consultado: migration 0007, media-bytes e media-library não foram transportados.
- Sem merge, rebase, cherry-pick ou instalação de dependências.

## Inventário e dependências

Estes 19 arquivos são byte a byte idênticos ao snapshot f44b196:

```text
shared/cms.ts
server/cms/validation.ts
server/cms/media-contract.ts
server/cms/handlers.ts
server/cms/http.ts
server/cms/repository.ts
functions/api/admin/site.ts
functions/api/admin/site/draft.ts
functions/api/admin/site/commands/[id].ts
migrations/0006_cms_foundation.sql
tests/backend/cms-contract.test.ts
tests/backend/cms-budget.test.ts
tests/backend/cms-media-contract.test.ts
tests/backend/cms-api.test.ts
tests/backend/cms-document-fixture.ts
tests/backend/cms-fixture.ts
tests/backend/cms-hardening.test.ts
tests/backend/cms-http.test.ts
tests/backend/cms-schema.test.ts
```

media-contract e os testes contract/budget/media-contract já eram idênticos em fc5bc30. shared/cms e validation usam a evolução f44b196: documento inicial null, recibos, materialização JSON e hardening de texto. Não se transportou media-proof ou relatórios históricos que poderiam ser confundidos com validação desta integração.

Reutilizados sem alteração: requireAdmin, AuthEnv/authJson/wrongMethod, adminWriteProof, validação Unicode do admin-catalog, handlers F2, migrations 0001–0005, fixtures D1 e runtime real da Etapa 1. A descoberta automática das Functions e migrations dispensa adaptar o runtime. O modelo de autenticação mantém o owner único e permite suas sessões distintas.

Outros quatro arquivos desta rodada:

- `tests/e2e-real/admin-real.spec.ts`: adapta as antigas expectativas de CMS inexistente para 401 autenticado e ausência da biblioteca/jobs/eventos. Acrescenta o caso CMS histórico e prova de isolamento da homepage. Os 18 casos anteriores permanecem.
- `e2e/admin-catalog-routes.spec.ts`: isola o contexto HTTP dos PATCH rejeitados antecipadamente; diagnóstico abaixo. Nenhuma expectativa removida.
- `tests/backend/cms-stage2-security.test.ts`: regressões adicionais de revogação/recibo entre sessões do mesmo owner e publicação bloqueada com envelope estruturalmente publicável.
- Este documento, novo.

Total: 23 arquivos candidatos, dois rastreados modificados e 21 novos. Nenhum arquivo de frontend, estilo, asset, catálogo, autenticação, build/configuração ou migration anterior foi alterado.

## Contrato e endpoints

| Endpoint | Semântica |
| --- | --- |
| GET /api/admin/site | Sessão F2 vigente, no-store, ETag; inicialmente draft.document=null e published=null |
| PUT /api/admin/site/draft | Sessão, origem/CSRF, If-Match forte igual ao expectedRevision, action=saveDraft |
| GET /api/admin/site/commands/:id | UUID v4, sessão vigente, recibo limitado ao ator original |

Preservados IDs estáveis, templates/atributos exatos, regiões monotônicas start/intro/catalog/details/end, cardinalidades por template e validação estrita. Limites: documento 65536 bytes UTF-8, envelope 66560 bytes, 24 módulos, headings 120 caracteres, textos 2000, listas 12 itens; leitura HTTP limitada a 5000ms. Textos e envelopes são materializados uma vez e a representação persistida é revalidada/canonicalizada.

O tipo/validador histórico conhece a intenção publish, porém handler e repositório só aceitam saveDraft. Triggers bloqueiam versões publicadas e ponteiros públicos. projectPublicCms e publicationMediaErrors permanecem funções puras sem rota pública, renderer, upload ou processamento. O teste suplementar verifica que um envelope aceito pelo validador publish continua recusado pelo HTTP, pelo repositório e pelo SQL.

O catálogo continua sendo a fonte de produtos, variantes, volumes e preços. fulfillmentMode só permite delivery. O telefone editorial fica inerte no rascunho; a homepage continua usando sua configuração atual e não lê esse documento.

## Migration e consistência

0006 cria quatro tabelas (cms_state, cms_versions, cms_media, cms_media_refs), índices, duas views e nove triggers. Inicializa somente revisão aleatória e ponteiros null, sem seed editorial/comercial ou objeto de mídia. cms_media é fundação referencial; não há biblioteca, produtor de mídia, jobs ou eventos.

A prova SQL de sessão é usada no comando e reavaliada antes/depois pelo trigger. Snapshot e recibo são a mesma linha imutável. operation_id único, ator e SHA-256 do envelope canônico identificam replay; ordem de arrays permanece significativa. Intenções novas usam CAS de revisão. Falhas de versão, refs, estado ou autorização abortam o statement e restauram recibo, referências e revisão.

Ensaios de schema ocorrem em Miniflare sem persistência e no D1 novo de cada diretório TEMP do runtime, com marcador de posse e descarte. Os logs Wrangler registram 0006 aplicada com sucesso (20 comandos). Não houve db:init/dev:full operacional, alteração de banco mantido ou remoto, nem migrations anteriores modificadas.

## Diagnóstico do E2E legado

A primeira suíte pública terminou 56/57: ECONNRESET no GET de cachacas após PATCH não autenticado com corpo. O teste isolado no baseline passou 2/2, o que não bastou para excluir a falha intermitente. Uma sondagem definida de 20 sequências sem retries reproduziu 20 resets no mesmo ponto com Functions/server/shared recompostos do baseline 11df9c8 em TEMP e 20 com os fontes atuais. Os handlers de autenticação e catálogo não foram alterados. O controle recompõe os handlers do baseline, não pretende reconstruir todo o frontend ou schema daquele commit.

Solução: somente o PATCH usa APIRequestContext próprio, descartado em finally. GETs e comparação do catálogo público continuam no contexto original. Mantidas expectativas 401/503, códigos de falha fechada, no-store, ausência de CORS, cardinalidade/preço público e todos os métodos/Allow do segundo teste. PATCH tem maxRetries=0; não se ignora transporte, não se repete requisição e não se alterou leitura de corpo no servidor.

A suíte pública completa após essa adaptação passou 57/57. A causa é delimitada à reutilização de conexão observada no Pages emulado; isso não demonstra comportamento remoto nem imunidade de qualquer cliente. Logs da falha inicial e os 40 resultados de diagnóstico foram preservados.

## Testes e gates

| Gate | Resultado |
| --- | --- |
| CMS histórico direcionado: sete arquivos | 126/126, exit 0 |
| Segurança suplementar | 2/2, exit 0 |
| Typecheck | PASS, exit 0 |
| Biome | PASS, exit 0, 280 arquivos |
| Vitest completo final | 940/940 em 63 arquivos, exit 0, 126,73s |
| Build normal | PASS, exit 0 |
| verify:dist | PASS, exit 0; 87 módulos e 120 literais |
| Build release + verify:release | PASS, exit 0; 135 módulos e 124 literais |
| E2E administrativo completo | 19/19, exit 0, 2,1min |
| E2E público completo final | 57/57, exit 0, 10,2s |
| E2E release completo | 19/19, exit 0, 2,2min |
| git diff --check | PASS, exit 0 |

Os testes específicos cobrem criação aditiva do schema, PRAGMA foreign_key_check, metadata inicial, concorrência com um vencedor, replay concorrente/canônico após avanço de revisão, conflito de intenção, sessão revogada/inativa/expirada/auth_version/origem alterada após guard, revogação dentro de trigger, rollback de ABORT/IGNORE/refs extras, versões imutáveis, mídia inexistente/deleting e publicação bloqueada em camadas.

O E2E CMS usa login real, PUT com resposta perdida, recuperação de recibo, replay, conflito, CSRF e catálogo integral preservado. Também verifica estado/recibo privados sem sessão, inexistência de rotas públicas CMS/publicação/mídia e ausência de requisições CMS ou texto privado na homepage. Os E2E de catálogo mantêm volumes fracionários, variantes, seleção mobile e mensagens WhatsApp. Nenhuma lógica comercial foi alterada.

A primeira versão de uma fixture suplementar tentou criar segundo usuário e foi recusada pelo singleton real do schema. O teste foi corrigido para duas sessões do mesmo owner, sem enfraquecer o banco; essa falha de modelagem de teste não é contada como defeito de produção. Um texto de documentação inicialmente emitido com encoding incorreto pelo pipe PowerShell foi regravado em UTF-8. Fontes históricos foram sempre copiados como bytes.

## Evidências e reprodução

Artefatos externos: `%TEMP%/chopp-stage2`. Contém origins.json, vitest.log, cms-security-final.log, typecheck.log, lint.log, build.log, verify-dist.log, release.log, e2e-real.log, e2e-release.log, public.log/public-results.json, public-before.log, baseline.log, transport-baseline/current.json e scripts/configurações temporários. Nenhum desses artefatos ou bancos está no inventário de entrega.

Comandos de validação:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --maxWorkers=2
npm.cmd run build
npm.cmd run verify:dist
npm.cmd run build:release
# build:release inclui verify:release
$env:CHROMIUM_PATH = 'C:/Users/zzzzz/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
$env:DELEGAS_INTEGRATION_PORT = '4213'
npm.cmd run test:e2e:real
$env:DELEGAS_INTEGRATION_PORT = '4214'
npm.cmd run test:e2e:release
node C:/Users/zzzzz/AppData/Local/Temp/chopp-stage2/public-runner.mjs
git diff --check
```

Vitest é executado sem E2E concorrentes porque o teste de limpeza compara diretórios globais TEMP. Depois de acrescentar as duas regressões de segurança, a suíte completa foi repetida; o resultado anterior era 938/938. Nenhuma dependência foi instalada ou teste ignorado.

## Riscos residuais e checkpoint

- Sem homologação remota ou prova de quotas/concorrência distribuída Cloudflare.
- Bancos mantidos continuam sem aplicar 0006 nesta rodada. Na ausência de schema válido as rotas falham fechadas; qualquer adoção operacional depende de autorização posterior.
- Contrato v1 mantém ordem histórica incompatível com barrels antes de ticker/catalog. Sua evolução requer rodada posterior autorizada; não se enfraqueceu o validador nem se conectou o documento à homepage C.
- Sem biblioteca, referências novas indisponíveis são recusadas por FK. Referências existentes não prontas podem integrar rascunhos, sem torná-los publicáveis. Retenção/GC e integridade de derivados são trabalho posterior.
- SQL guards protegem a aplicação, não um operador com acesso arbitrário ao schema.
- Nenhuma confirmação de comportamento remoto decorre dos ensaios de transporte locais.

Não há commit, staging Git, push, merge, rebase, staging Cloudflare, deploy ou alteração de banco mantido/remoto. Sem CMS v2, publicação, biblioteca de mídia ou editor. Parar neste checkpoint para auditoria independente.

Veredito final: GO para auditoria independente da Etapa 2. Todos os gates solicitados foram aprovados. Não representa autorização de commit, próxima etapa, staging ou produção.

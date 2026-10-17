# F4A.2A — evidências e entrega local

Data: 16/10/2026. Implementador: Codex, por substituição explicitamente autorizada
pelo usuário. Auditor independente: outro agente, ainda não executado.

## Preflight e escopo

Worktree `C:\Users\zZzZz\Projetos\chopp-delivery-integration`.
Branch `integration/delegas-f3`; HEAD inicial esperado e confirmado
`f44b19668eabdfa0d9a4e0c4da49db558406479d`.
Status inicial limpo; staging vazio. Contratos L0A.2, laboratório, migration 0006,
guard e predicado SQL F2, wrapper Pages/Miniflare e tipos instalados inspecionados.
Nenhuma divergência inicial. O Git em sandbox emite aviso de leitura negada para
o ignore global do usuário; comandos de status executam normalmente.

Sem alteração da migration 0006, catálogo, regras comerciais, auth F2,
wrangler.jsonc, dependências ou lockfile. Sem recursos, bucket ou Worker remoto,
publicação, editor, upload produtivo, staging, commit, push, merge, rebase ou deploy.

Arquitetura, APIs, lifecycle e bloqueios: [cms-media-local.md](cms-media-local.md).

## Testes e gates da entrega anterior à auditoria

| Gate | Resultado final |
| --- | --- |
| Mídia adversarial + upgrade D1 | 39/39, 3 arquivos, 57,48 s |
| Vitest completo | 1176/1176, 72 arquivos, 176,83 s |
| Chrome integração real | 23/23, 2,9 min |
| Chrome release | 23/23, 2,9 min |
| Typecheck frontend/backend | PASS, incluído nos dois builds finais |
| Biome | 305 arquivos, sem erros, warnings ou infos |
| Build normal + verify:dist | PASS; 5 arquivos, 89 módulos, 129 literais verificados |
| Build release + verify:release | PASS; 5 arquivos, 137 módulos, 133 literais verificados |
| npm audit | 0 vulnerabilidades, 202 dependências, nenhuma dependência alterada |
| Whitespace | PASS nos 16 arquivos, incluindo novos por diff --no-index --check |
| Inventário/segredos | Somente 16 caminhos previstos; sem banco/artefato temporário; padrões conhecidos de chaves não encontrados |

Comandos: npm test -- --maxWorkers=2; Vitest focado nos três arquivos media-*;
PLAYWRIGHT_CHANNEL=chrome com npm run test:e2e:real e test:e2e:release;
npm run build, verify:dist, build:release, verify:release, lint e npm audit --json.
Sem supressões, testes desabilitados, retries ou aumento de timeout dos testes
existentes. Novos testes de timeout têm limite de 10 s para provar prazo de 5 s.
Verificação de segredos por padrões é limitada, não um scanner completo.

Cobertura adversarial executada: sessão ausente/revogada e revogação durante o
processamento; origem incorreta/cross-site; precondições; MIME forjado; truncamentos
e corrupção JPEG/PNG/WebP; APNG control chunk e WebP animado real; dimensão e
pixel bomb; excesso real de bytes; leitura/processador/R2 sem resposta; falha do
processador; R2 antes/depois de put; D1 após os dois objetos; concorrência e retry;
referência inexistente; exclusão referenciada somente por módulo oculto; exclusão
parcial; lease vencida; órfão sem dono; saídas com metadados/assinatura forjada;
estados não publicáveis. Os testes verificam linhas D1, jobs, manifestos e objetos
R2, além de status HTTP. Original não gravado e manifesto interno não exposto.

Upgrade testado com rascunho/histórico/referências existentes na 0006; 0007 preserva
esses dados e o catálogo, adiciona revisão m0 e mantém published_version_id NULL.

E2E novo usa Chrome, login F2, Pages reais compiladas, Worker privado, Images
offline e R2. Verifica upload, replay sem duplicação, referência em rascunho,
exclusão negada e rota pública de mídia ausente. As suítes antigas continuam
verificando que o opt-in desativado não expõe a API de mídia.

## Histórico de falhas e correções

- RED inicial: import do módulo de intake ainda inexistente; depois 5/5 passaram.
- Primeira rodada de lifecycle: 17 passaram e 7 falharam por fixture usando `type`
  em vez do discriminante real `template`. Corrigida a fixture, sem relaxar asserts.
- Primeira compilação de testes encontrou divergência de tipos de Headers entre
  Miniflare/undici e Workers. A interface do armazenamento foi reduzida aos métodos
  efetivamente utilizados, estruturalmente compatíveis. Sem any/ts-ignore/cast duplo.
- Primeiro E2E de mídia falhou no startup: d1Persist foi colocado no Worker ao
  compor múltiplos Workers, mas é opção global. EPIPE no teardown encobriu o erro
  de inicialização. Corrigido o escopo; novo E2E passou 1/1 (8,5 s).
- Primeira suíte completa Vitest: 1170 passaram, 1 falhou (71 arquivos, 182,45 s).
  Rodou em paralelo com E2E release. O teste de cleanup compara todos os diretórios
  globais `delegas-admin-integration-*` e observou um laboratório criado pela suíte
  E2E. Reexecução final é isolada dessas suítes; não se alterou o teste de cleanup.
- Rodadas intermediárias adversariais: 34/34 em 2 arquivos (41,79 s), depois
  35/35 em 3 arquivos (51,67 s). Novos ataques e limites foram acrescentados depois.
- Script temporário de evidência exigiu correção de imports ESM Windows para
  file URLs e resolução do entrypoint instalado de sharp. Nenhuma mudança de produto.

## Evidência de processamento pelo binding

Fixture sintética 2400x1600, cor #803020, com metadados. Serviço privado real em
workerd chama Images emulado offline. Sharp é gerador/inspector de fixtures.

| Fonte | Perfil | Dimensões | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| PNG | hero | 1620x1080 | 3240 | 436cbdbaf5dabfaba8926bf30be23fd827e90d8fc745f0c43c3ab8f6d847e1f8 |
| PNG | section | 1200x800 | 1790 | 48586283a915debcd0830e449a70e53d211aa899fb5de762c9e9095935408bdc |
| JPEG | hero | 1620x1080 | 3236 | c38230c08c490f5a8f524e634aa35b12368cfacd7a90bb394b69045cb723e5b6 |
| JPEG | section | 1200x800 | 1786 | d263dd1f496a5fe5b4bff7ebbc1457ca280d7a2d77ae6df455b71cd75c13b371 |
| WebP | hero | 1620x1080 | 3246 | 5599a43ecf14e28a1bb3d1b89b8fde9e2d81516f799a28f0ddc5cc9ba93c68ad |
| WebP | section | 1200x800 | 1786 | fa01d46f2cb7617d389d3831e7897fc7c3f4da75fb66c22adf1fe656cc03510d |

6/6 sem EXIF, ICC, IPTC, XMP ou orientação no output. `remoteExecuted:false`.
Artefatos fora do Git em `%TEMP%`: `delegas-f4a2a-binding-proof.json` e script
`.mjs` correspondente. A suíte `media-library.test.ts` reproduz o processamento e
a conferência de metadados pelo mesmo Worker. O corpus é sintético e limitado,
não constitui certificação de segurança do decoder ou sanitização remota.

## Inventário

3 arquivos existentes alterados:

- `scripts/dev-admin-integration.mts`
- `tests/e2e-real/admin-real.spec.ts`
- `tests/e2e-real/server.mts`

13 arquivos novos:

- `functions/api/admin/media.ts`
- `functions/api/admin/media/[id].ts`
- `functions/api/admin/media/reconcile.ts`
- `migrations/0007_cms_media_local.sql`
- `scripts/local-image-worker.mjs`
- `scripts/local-image-worker.d.mts`
- `server/cms/media-bytes.ts`
- `server/cms/media-library.ts`
- `tests/backend/media-intake.test.ts`
- `tests/backend/media-library.test.ts`
- `tests/backend/media-upgrade.test.ts`
- `docs/cms-media-local.md`
- `docs/f4a2a-validation.md`

## Limitações e encaminhamento

NO-GO produtivo: nenhuma prova remota de Images/Worker/Pages/R2/D1, isolamento
staging/produção, metadados/orientação, cancelamento, memória/CPU, quotas ou custos.
Não há código sharp no runtime. URLs arbitrárias continuam fora do documento CMS.
Publicação permanece bloqueada por SQL. Reconciliação requer administrador e pode
precisar de repetição após efeitos R2 tardios; não há scheduler ou garantia de
transação entre serviços. Não há reparo automático de objetos ready removidos
externamente, GC de versões/referências, importação ou upload direto de browser.
Não há contratação ou dependência paga nova. Pré-requisitos e fontes oficiais
estão no documento de arquitetura.

GO para encaminhar esta implementação LOCAL à auditoria independente de outro
agente. Não há aprovação para commit, deploy, produção ou publicação. Essa
classificação apenas indica conclusão dos gates de implementação; não constitui
auditoria independente ou autoaprovação. Aguardar nova instrução.

Estado final Git: branch integration/delegas-f3; HEAD inalterado
f44b19668eabdfa0d9a4e0c4da49db558406479d; 3 arquivos modificados e 13 novos;
staging vazio. Nenhum commit criado.

Logs externos em %TEMP%: delegas-f4a2a-vitest-delivery.log,
delegas-f4a2a-adversarial-final.log, delegas-f4a2a-e2e-real-delivery.log,
delegas-f4a2a-e2e-release-delivery.log, delegas-f4a2a-build-delivery.log,
delegas-f4a2a-build-release-delivery.log, delegas-f4a2a-audit.json.
Manifesto externo de hashes: delegas-f4a2a-delivery-sha256.json.

## Correção pós-auditoria P2-1 e P3-2 — 16/10/2026

Autorização limitada a parsing, regressões e estes dois documentos. Antigravity
aprovou a arquitetura local, reproduziu P2-1 WebP e indicou P3-2 JPEG. Reauditoria
direcionada pendente; não há autoaprovação nem solicitação de commit.

Preflight: branch/HEAD e inventário exatamente iguais à entrega anterior,
3 modificados + 13 novos, staging vazio. Todos os 16 hashes coincidiram com
`%TEMP%/delegas-f4a2a-delivery-sha256.json`; nenhuma mudança posterior detectada.
O manifesto auditado foi preservado; a correção terá manifesto externo próprio.

P2-1: dimensões do frame podiam ser sobrescritas por VP8X tardio. Agora header
estendido só pode ser inicial e único; dimensões de canvas/frame são independentes
e precisam coincidir. A validação cobre também chunks conhecidos duplicados,
bitstreams incompatíveis, ALPH/ICCP fora de ordem, padding, campos reservados e
flags conflitantes/sem chunk. Metadados e chunks desconhecidos de entrada estendida
não são confundidos com derivados sanitizados. Não houve mudança do decoder.

P3-2: `width` era usado como sentinela de SOF; zero permitia aceitar outro SOF.
Agora há `frameSeen` explícito e rejeição imediata de dimensão zero, duplicação,
SOF incompatível e cabeçalhos de componentes/precisão/comprimento malformados.
O subset não admite altura zero resolvida por DNL. Baseline/progressivo, grayscale
e CMYK reais continuam cobertos por decode das fixtures e inspeção estrutural.

RED inicial: 23 falhas e 18 passes em 41 testes (1,42 s) contra o parser auditado.
O bypass WebP chegou ao CMS_MEDIA_PROCESSOR e retornou 503 no contraexemplo
administrativo, em vez da rejeição 400 exigida. GREEN inicial: 41/41 (2,94 s).
Acrescentados depois WebPs reais, completamente decodificados como controles,
simples VP8 e VP8L, com VP8X residual anexado e tamanho RIFF recalculado. RED
final contra o parser auditado: 24 falhas e 18 passes em 42 testes (1,72 s).
GREEN final: 42/42 (3,04 s). O parser corrigido foi restaurado em finally; seu
hash é idêntico ao executado nos builds e nas duas suítes Chrome completas.
O teste administrativo percorre os 32 casos de entrada malformada, exige
rejected/failed persistidos e zero chamadas ao processador e armazenamento.
São 37 testes novos no arquivo existente; nenhum arquivo novo no inventário.

Gates finais da correção:

| Gate | Resultado |
| --- | --- |
| RED final contra parser auditado | 24 falhas / 18 passes, 42 testes, 1,72 s |
| GREEN direcionado final | 42/42, 3,04 s |
| Mídia/D1 e prova offline | 84/84, 5 arquivos, 57,29 s; prova offline mantém 27 casos |
| Vitest completo final | 1213/1213, 72 arquivos, 172,97 s |
| Chrome integração | 23/23, 2,9 min |
| Chrome release | 23/23, 3,1 min |
| Typecheck | PASS, frontend e backend |
| Biome | 305 arquivos, sem erros, warnings ou infos |
| Build normal + verify:dist | PASS, 5 arquivos, 89 módulos, 129 literais verificados |
| Build release + verify:release | PASS, 5 arquivos, 137 módulos, 133 literais verificados |
| npm audit | Zero vulnerabilidades, 202 dependências |
| Whitespace | PASS, incluindo os arquivos não rastreados |

Antes do teste real residual adicional, a rodada completa passou 1212/1212 em
175,32 s; a rodada final acima inclui esse teste. Os E2E e builds executaram o
mesmo hash do parser final; depois deles só houve adição de teste e documentação.
Typecheck e Biome passaram novamente após o teste adicional. Nenhuma asserção,
limite ou timeout existente foi relaxado.

Delta frente ao pacote auditado, exclusivamente quatro arquivos:

- `server/cms/media-bytes.ts`
- `tests/backend/media-intake.test.ts`
- `docs/cms-media-local.md`
- `docs/f4a2a-validation.md`

P3 obrigatório preservado: finalizar cms_media/cms_media_jobs em duas alterações
D1 separadas pode deixar ready com job running/failed. Não corrigido aqui; requer
intervenção específica com atomicidade D1, guards e testes antes da integração
produtiva. A futura F4A.3 deve conferir existência e integridade R2 de cada objeto
contra o manifesto antes de publicar, mesmo com mídia ready. Nenhuma dessas
pendências é resolvida pelo endurecimento dos parsers.

Sem alterações em autenticação, SQL, R2, Worker, contratos HTTP, migrations,
publicação ou dependências. Sem staging, commit ou operação Cloudflare remota.
Recomenda-se reauditoria direcionada pelo Antigravity de P2-1/P3-2, da gramática
WebP estática, dos SOF e dos contraexemplos antes de qualquer solicitação de commit.
Esta entrega não constitui aprovação independente ou aprovação produtiva.

Estado Git final: branch integration/delegas-f3; HEAD inalterado
f44b19668eabdfa0d9a4e0c4da49db558406479d; mesmos 3 modificados + 13 novos;
staging vazio. Os outros 12 arquivos do pacote auditado mantêm seus hashes.

Logs em %TEMP%: delegas-f4a2a-parsing-red-final.log,
delegas-f4a2a-parsing-green-final.log, delegas-f4a2a-parsing-media-final.log,
delegas-f4a2a-parsing-vitest-final.log, delegas-f4a2a-parsing-e2e-real.log,
delegas-f4a2a-parsing-e2e-release.log, delegas-f4a2a-parsing-build.log,
delegas-f4a2a-parsing-release-build.log e delegas-f4a2a-parsing-audit.json.
Manifesto final: delegas-f4a2a-parsing-delivery-sha256.json. O manifesto anterior
delegas-f4a2a-delivery-sha256.json continua preservado como base auditada.

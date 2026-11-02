# F4A / Etapa 4 / CP3 — Repositório e API administrativa CMS v2

## Escopo e baseline

Branch `integration/immersive-cms-f4a`; HEAD `740180e63d0b94a71a714638e03fec360904fd49`, preservado. CP1 `1b55137ae75b23f0ed2d3aab151ca0446b6e9ecf` e CP2 constam no histórico. Índice inicialmente vazio. A especificação foi lida integralmente e conferida pelo SHA-256 `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873`.

Os dez arquivos CP2 foram conferidos contra o manifesto, `delivery-hashes.json` e os blobs do commit confirmado pelo usuário. As migrations 0001–0009 permanecem byte a byte iguais. A tabela de hashes de um relatório independente anterior contém valores divergentes do manifesto entregue para nove arquivos; não foi usada para substituir os hashes da entrega e do baseline explicitamente confirmado. A 0009 corresponde ao SHA-256 `debc419a6f6ca7f3652d61c7cd82b1f2dab2360da6b7a98e18776f93d8ce5a22`.

Implementação restrita ao despacho de repositório, API privada e seus testes. Sem alteração de SQL, catálogo, autenticação, biblioteca de mídia, `src/`, homepage ou projeção pública. Não há rota pública de CMS, editor, publicação ou CP4. Nenhum banco mantido/remoto foi utilizado; todos os testes D1 usam Miniflare sem persistência ou diretórios temporários de propriedade do harness.

## Implementação e compatibilidade

| Área | Comportamento implementado |
|---|---|
| Prontidão | Consulta `sqlite_schema` antes de acessar `cms_ready_v2`; só lê tabelas v2 se a view retorna prontidão. Ausência/instalação incompleta mantém v1 e devolve 503 `CMS_SCHEMA_UNAVAILABLE` às operações v2. |
| Cabeçote | Estado persistido determina schema null/1/2. GET retorna `schema`, `warnings`, `published: null` e ETag da revisão lida. Estado v2 incoerente falha fechado. |
| v1 | Implementação histórica extraída para `repository-v1.ts`. Comparação textual confirmou corpo do repositório e canonicalização iguais ao HEAD, salvo nome/export/import. Validador v1 congelado permanece intacto. Escritas continuam v1 antes da conversão. |
| DTOs | GET ativo usa `CmsVersionedAdminSnapshot`. Tipos legados continuam disponíveis. Recibos v1 permanecem com o formato original, sem adicionar `schema` ou avisos retroativos; recibos v2 incluem schema 2. Essa distinção preserva a compatibilidade e o replay exato de recibos históricos. |
| Revisões | Parser de mutação versionado admite `c1_` e `c2_`; documento e cabeçote distintos produzem 409 de schema, época incompatível produz 409 de revisão. Validação documental v1 não foi enfraquecida. |
| Conversão | `previewConversion` calcula sem escrita. `convertToV2` lê versão v1 imutável e calcula no servidor; qualquer `document` do cliente é rejeitado. `startV2` exige CMS vazio e carrossel visível. |
| Comando atômico | `UPDATE cms_v2_write` e prova de sessão no mesmo `db.batch`; SQL auditado controla origem, fonte, revisão, namespace, referências e estado. Resposta é conferida contra a linha persistida; conversão é comparada novamente com a fonte v1 imutável. |
| Idempotência | Hash canônico SHA-256; ações v2 incluem schema 2. Conversão inclui requisição e acknowledge ordenado, não conteúdo calculado. Consulta recibo antes de validar estado atual; se outra requisição conclui entre consulta e leitura do cabeçote, nova consulta recupera o recibo antes de retornar conflito. Não há retry automático da escrita. |
| Recibos | GET e replay retornam versão imutável da operação, mesmo após edições/conversão. Outro ator não recebe recibos (404); reutilização por ator, ação ou conteúdo diferente retorna 409. |
| Avisos | `ITEM_MISSING`, `ITEM_HIDDEN`, `MEDIA_NOT_READY`, `COMPOSITION_WITHOUT_CAROUSEL`, calculados somente no GET e sem modificar referências ou recibos. |
| Segurança | Guardas reais de sessão, origem/CSRF, prova reavaliada pelo SQL e após persistência. Allowlist dos campos de resposta; não retorna ator, sessão, hash interno, manifesto ou objectKey. Publicação recusada pelo handler, repositório e triggers existentes. |

`commands.ts` materializa uma vez a entrada, exige chaves exatas, revisão, UUID e ações conhecidas. Acknowledge é reservado: até 24 textos únicos de até 120 caracteres, ordenados para o hash; a conversão atual tem `losses: []`. Confirmações de perdas futuras seriam obrigatórias antes da gravação. Nenhuma confirmação abre publicação.

## Rotas privadas

| Rota | Contrato |
|---|---|
| `GET /api/admin/site` | Snapshot do cabeçote e ETag. |
| `PUT /api/admin/site/draft` | `saveDraft`, despacho por `document.schemaVersion`, If-Match obrigatório igual à revisão do corpo. |
| `POST /api/admin/site/convert` | `previewConversion`, `convertToV2` ou `startV2`; única rota nova, adaptador Pages fino. |
| `GET /api/admin/site/commands/:id` | Recibo original filtrado pelo ator e sessão vigente. |

If-Match ausente: 428; formato inválido ou diferente do corpo: 400; conflito com o estado persistido: 409. Erros de item/mídia: 400. Prontidão ausente: 503. Métodos incorretos: 405 e Allow. Resposta perdida após commit não duplica efeitos: o cliente recupera por operação/replay. Falha de conferência da persistência retorna `CMS_WRITE_INCOMPLETE`, nunca sucesso presumido.

## Acoplamento TS ↔ SQL inspecionado manualmente

- `cms_v2_write` recebe todos os campos de comando: IDs, revisões, documento canônico, hash, ator/sessão/origem, `origin_kind`, `source_version_id`.
- `cms_v2_write_command` confirma sessão antes/depois, fonte/revisão corrente na conversão e replay no namespace das duas versões. Nenhum token ou dado R2 integra a resposta.
- `cms_v2_versions` e `cms_v2_media_refs` são imutáveis; escrita v1 é bloqueada após supersessão. Caminhos `$.modules[*].content.media.id`, `$.content.entries[*].media.id` e `itemId` foram conferidos com `collectMediaRefs` e a migration.
- Categoria comercial continua sendo `chopes`. CMS somente referencia item existente; não grava preços, volumes, variantes, disponibilidade ou tabelas comerciais.
- Guardas de mídia rejeitam referências inexistentes/deleting/deleted e impedem exclusão das referências históricas, inclusive aquelas presentes somente em entries.
- `cms_ready_v2` continua sendo o último objeto da migration. Nenhuma migration foi alterada ou aplicada a banco mantido.

## Testes e evidências adversariais

Artefatos de execução: `C:/Users/zzzzz/AppData/Local/Temp/chopp-stage4/cp3/`.

1. `red.log`: 15 testes CP3 inicialmente vermelhos contra o comportamento anterior, com falhas de status/contrato (não erro de importação). Casos suplementares foram acrescentados durante a revisão; não são declarados retroativamente como executados contra o baseline.
2. Preview sem escrita, igualdade com conversor e commit; rejeição de documento enviado para conversão; início vazio e carrossel explícito; replay de recibos v1/v2 após novas edições.
3. Duas conversões, conversão × save v1, mesma revisão v2 com operações diferentes, operações idênticas concorrentes, colisões de ação/conteúdo e namespace v1/v2.
4. `red-interleaving-both.log`: dois testes determinísticos demonstraram 409 indevido quando a operação concluía entre busca do recibo e leitura do cabeçote. Correção mínima reconsulta o recibo antes de rejeitar estado/revisão. Não altera os triggers nem reaplica escrita.
5. Instalações parciais: 22 bancos independentes (prefixos incompletos k=0..21 da 0009, cujo total é 22 statements), com GET/PUT v1 reais pelos handlers e quatro operações v2 retornando 503. Os testes CP2 existentes mantêm a varredura completa de 23 prefixos, controle negativo e Wrangler.
6. Falhas injetadas: revogação antes do batch e dentro do trigger; comando ignorado; resposta perdida após commit; resultado adulterado. Falhas não autorizam escrita parcial nem reportam sucesso falso.
7. Origem e sessão inválidas, recibo atribuído a outro ator, If-Match, desconhecimento de schema, limites de corpo, mídia ausente/deleting, produto ausente/oculto, corrida save × delete e ausência de vazamento.
8. Os testes existentes não foram relaxados. Na preparação dos novos testes, duas revisões de fixture foram corrigidas para representar o cabeçote real. Outro teste expôs o matcher HTTP que não reconhecia o dígito em `CMS_ALREADY_V2`; corrigido para códigos com letras, números e underscore.
9. E2E Pages novo percorre sessão real → v1 → preview → conversão → edição v2 → recibos/replay históricos, preservando o catálogo e publicação nula. Acrescentado ao arquivo administrativo sem alterar o corpo de nenhum teste anterior; executado nos modos administrativo e release.

### Diagnóstico de execução local

A primeira execução completa foi interrompida para incluir os testes determinísticos da janela de replay e não representa aprovação. Durante a sobreposição com testes direcionados houve `connect EADDRINUSE` no proxy Miniflare, inclusive em testes legados. `netstat` registrou 17.623 conexões loopback em TIME_WAIT; `netsh` confirmou faixa dinâmica 49152–65535 (16.384 portas). Apenas os processos do runner desta rodada foram encerrados; os serviços externos foram preservados. Aguardou-se a liberação das portas e a validação final é sequencial, com um worker Vitest. Não foram alterados timeouts, assertions, retries, rede do Windows ou configurações de projeto. Os logs dessas tentativas permanecem disponíveis e não são contados como gates verdes. A primeira rodada isolada posterior aprovou 39/40 testes; o único erro foi de preparação do teste novo de ator, que tentava criar um segundo proprietário e foi corretamente rejeitado pelo UNIQUE `admin_users.singleton`. O teste foi corrigido sem alterar SQL: injeta somente o ator divergente no resultado de leitura, mantendo autenticação real, recibo persistido e a restrição F2. A filtragem 404/409 é testada; não se afirma ter criado múltiplos administradores no modelo de conta única.

## Graphify

Skill lida; consultas prévias em `graph-before-query.log` e `graph-before-handlers.log`, conferidas diretamente no código. Atualização AST incremental autorizada, sem instalar dependências, modificar hooks/configurações ou enviar conteúdo a serviços externos. A reavaliação final contém 1.503 nós, 3.919 arestas e 85 comunidades; nenhum ciclo dirigido de imports/reexports foi encontrado. A primeira atualização foi repetida após os casos suplementares de concorrência. `graph-output-changes.json` registra nove arquivos gerados alterados e três caches AST adicionados, todos dentro de `graphify-out/`; nenhum arquivo externo ao grafo mudou durante as atualizações.

Dependências: rota → handlers → comandos/validação/repositório → prova administrativa, conversor e coletor; repositório delega v1 ao módulo preservado e v2 ao comando SQL auditado. Não há novo consumidor em React/LandingPage. Análise dirigida de imports/reexports é registrada em `graph-cycles.json`.

Limites: ausência local de `tree_sitter_sql` significa que nove arquivos SQL não contribuíram para o grafo. Nenhuma dependência foi instalada. O grafo também não comprova caminhos JSON, atomicidade ou semântica de triggers; esses pontos foram inspecionados e testados no D1 descartável.

## Gates e encerramento

Todos os gates finais aprovados, sem testes pendentes ou falhando. As suítes E2E foram executadas em sequência, após encerrar o Vitest.

| Comando | Exit code | Duração (s) | Resultado |
|---|---:|---:|---|
| `npm run typecheck` | 0 | 1.25 | Aprovado |
| `npm run lint` | 0 | 0.73 | 38 warnings e 13 infos não bloqueantes; sem correções globais |
| `npm test -- --maxWorkers=1` | 0 | 711.55 | 1.128/1.128 testes; 80/80 arquivos; 20 casos novos CP3 |
| `npm run build` | 0 | 2.24 | Aprovado |
| `npm run verify:dist` | 0 | 0.91 | Aprovado |
| `npm run build:release` | 0 | 2.67 | Aprovado |
| `npm run verify:release` | 0 | 0.53 | Aprovado |
| `node %TEMP%/chopp-stage4/cp3/public-runner.mjs` | 0 | 20.94 | 57/57; produção normal; porta 4212 |
| `npm run test:e2e:real` | 0 | 191.95 | 21/21; porta 4213; inclui CP3 via Pages real |
| `npm run test:e2e:release` | 0 | 233.06 | 21/21; porta 4214; inclui CP3 via Pages real |
| `git diff --check` | 0 | — | Sem erros de whitespace |

O runner público conserva a seleção pública de 57 testes da validação CP2 e utiliza o servidor real existente em modo production com D1 próprio. Não foi usado o `webServer` padrão que escreve em `.wrangler/e2e-state`. Os testes de painel mock não fazem parte dessa seleção; a administração real é exercitada integralmente nas duas suítes de 21 testes. `gates.json` contém comandos, exit codes e durações; cada gate tem seu `.log` no diretório CP3.

O Vitest completo inclui os 22 testes CP2 auditados, os 23 prefixos independentes, diferencial TS↔SQL de 300 documentos, testes de conversão CP1 e os 20 casos novos CP3. `wrangler-results.json` foi copiado da evidência gerada nesta execução (`chopp-cp2-wrangler-evidence-pTopoU`).

| Wrangler descartável | Exit esperado observado | Prontidão v2 | Save/replay v1 e recibo anterior |
|---|---:|---|---|
| Completo | 0 | Sim | Preservados |
| F1, F2, F3, F4 — falhas injetadas | 1 em cada caso | Não | Preservados; rollback da instalação observado |
| F5 — reaplicação gerenciada/não gerenciada | 0 no fluxo esperado | Sim | Preservados |

Esses resultados descrevem o D1 local emulado; não generalizam atomicidade de migrations para D1 remoto.

## Manifesto exclusivo CP3

Arquivo de entrega: `C:/Users/zzzzz/AppData/Local/Temp/chopp-stage4/cp3/delivery-files.txt`. Hashes brutos finais SHA-256 em `delivery-hashes.json`, no mesmo diretório. Exatamente **14 arquivos: cinco modificados e nove novos**.

| Arquivo | Estado | Origem/finalidade |
|---|---|---|
| `shared/cms/v2.ts` | Modificado | Contrato CP1 preservado; requisição discriminada estrita de conversão acrescentada. |
| `server/cms/validation-v2.ts` | Modificado | Parser CP1 versionado passa a aceitar token de ambas as épocas também para documentos v1; documento v1 continua no validador congelado. |
| `server/cms/repository.ts` | Modificado | Despacho e persistência v2 sobre comando SQL CP2, usando a base v1 preservada. |
| `server/cms/handlers.ts` | Modificado | Extensão dos handlers v1 com despacho, conversão e erros versionados. |
| `tests/e2e-real/admin-real.spec.ts` | Modificado | Apenas acréscimo de um teste; corpos dos 20 anteriores iguais ao HEAD. |
| `server/cms/repository-v1.ts` | Novo | Extração do repositório do HEAD; corpo comparado textualmente e preservado. |
| `server/cms/canonical.ts` | Novo | Canonicalização extraída sem mudanças e helper SHA-256. |
| `server/cms/commands.ts` | Novo | Validação estrita da requisição de conversão/início. |
| `functions/api/admin/site/convert.ts` | Novo | Adaptador Pages privado. |
| `tests/backend/cms-v2-api-fixture.ts` | Novo | Adaptação do harness D1 descartável CP2 para handlers HTTP reais. |
| `tests/backend/cms-v2-api.test.ts` | Novo | Oito testes: conversão, replays e concorrência, incluindo duas intercalações determinísticas. |
| `tests/backend/cms-v2-http.test.ts` | Novo | Três testes, incluindo 22 instalações parciais independentes. |
| `tests/backend/cms-v2-security.test.ts` | Novo | Nove testes de segurança, falhas e referências de mídia. |
| `docs/immersive-cms-stage4-cp3.md` | Novo | Este relatório. |

O código dos arquivos novos foi revisado, assim como os diffs dos cinco modificados. Não foram encontrados segredos, chaves privadas, artefatos gerados ou alterações externas no manifesto. Fixtures permanecem restritas aos testes; bundles aprovados pelos verificadores. Nenhum arquivo foi preparado no índice.

## Preservação final

Branch e HEAD permanecem os do baseline. Índice vazio. Os dez arquivos CP2 e todas as migrations 0001–0009 conservam os hashes iniciais. Não houve alteração de fonte durante os gates finais; apenas o relatório foi completado depois deles. A comparação antes/depois do Graphify confirmou ausência de alterações fora de sua pasta gerada.

| Arquivo protegido | SHA-256 final, igual ao inicial |
|---|---|
| `.gitignore` | `8e50a25a8e259b2912835c6a77a1b03dfd0558e24315c1d1470a5972af587668` |
| `.claude/settings.json` | `f4e5f81ee806e3792a2c9c57285c1ce009be083019f42ac8e435bd4790ab8b2a` |
| `.claude/settings.local.json` | `21dcff94caa79881e580b87945186af2bd9c54ada5665497196b9bd835f9f816` |
| `CLAUDE.md` | `55189e0bb8f83d9de53de3142fc8702c6ec45d01df3478da4b8224cb0d20d83c` |
| `docs/immersive-cms-stage4-spec.md` | `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873` |
| `e2e/catalog-atomic-routes.spec.ts` | `0abbe95a5ac242093f8f4227aa321577a7a2ddd6b9c18157a78aaae1b64c5985` |

Estado Git final (`git status --short --untracked-files=all`):

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
 M server/cms/handlers.ts
 M server/cms/repository.ts
 M server/cms/validation-v2.ts
 M shared/cms/v2.ts
 M tests/e2e-real/admin-real.spec.ts
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-stage4-cp3.md
?? docs/immersive-cms-stage4-spec.md
?? functions/api/admin/site/convert.ts
?? server/cms/canonical.ts
?? server/cms/commands.ts
?? server/cms/repository-v1.ts
?? tests/backend/cms-v2-api-fixture.ts
?? tests/backend/cms-v2-api.test.ts
?? tests/backend/cms-v2-http.test.ts
?? tests/backend/cms-v2-security.test.ts
```

As alterações externas continuam fora do manifesto: `.gitignore` e correção CP0 modificados; configuração Graphify, CLAUDE.md e especificação não rastreados. `.claude/settings.local.json` continua ignorado e preservado. A saída Graphify gerada permanece ignorada e fora da entrega.

**Veredito: GO técnico para auditoria independente do CP3.** Não é autorização de consolidação, CP4, publicação, staging ou produção. Nenhum commit, push, merge, rebase, deploy ou migration em banco mantido foi executado. Checkpoint encerrado.


## Riscos residuais

- Verificação realizada em D1/Pages emulados e descartáveis; não comprova homologação em infraestrutura remota, não autorizada nesta etapa.
- Biblioteca mantém o limite histórico de 100 registros, incluindo tombstones. Retenção/GC seguem decisões futuras, sem reparos silenciosos nesta entrega.
- Estado `ready` de mídia e avisos são observações de estado; não garantem disponibilidade permanente dos objetos nem autorizam publicação.
- Consumidores de snapshots ativos devem discriminar schema null/1/2; recibos v1 continuam no contrato legado. Nenhum editor ou consumidor React foi conectado nesta etapa.
- A especificação, CP0 e configurações externas continuam fora da entrega. Sem commit, operações remotas, migrações mantidas ou início do CP4.

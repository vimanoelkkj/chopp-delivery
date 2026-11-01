# Etapa 4 / CP2 — estrutura e persistência SQL CMS v2

**Estado atualizado após recuperação: GO para auditoria independente.** A migration e os testes adversariais permanecem íntegros; apenas o carregamento do parser no harness e este relatório mudaram.

Branch `integration/immersive-cms-f4a`; HEAD preservado `1b55137ae75b23f0ed2d3aab151ca0446b6e9ecf`.
Especificação: `docs/immersive-cms-stage4-spec.md`, SHA-256 `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873`.

## Escopo e manifesto

Somente a migration aditiva `0009_cms_v2.sql`, oito arquivos de testes/harness e este relatório. Dez arquivos novos; nenhum arquivo versionado foi modificado pelo CP2. O manifesto e os hashes ficam em `%TEMP%/chopp-stage4/cp2/delivery-files.txt` e `delivery-hashes.json`. Não incluem CP0, arquivos externos, especificação ou Graphify. Nenhum commit, publicação, editor, consumo React, staging ou operação remota.

## Modelo SQL

A migration tem 22 statements de topo, nesta ordem: quatro tabelas e dois índices; triggers locais; três triggers em tabelas legadas; view de escrita e trigger atômico; `cms_ready_v2` por último. Há 14 triggers novos, todos enumerados na prontidão, além da exigência das migrations 0006–0009, tabelas v2 e catálogo, view de comando e `cms_ready` v1 verdadeira.

Decisão de implementação CP2: acrescentar `cms_v2_write_guard`, um fence efêmero de comando inspirado na 0008. Sua linha é criada sob prova de sessão e prontidão, identifica versão/operação/ator, autoriza somente as inserções e transição correspondentes e é apagada no mesmo statement. Qualquer erro reverte também o fence. O estado v2 não é semeado; nasce no `start` ou `convert`. Nenhuma migration anterior foi editada.

`cms_v2_write` revalida sessão, ativo/auth_version/origem/expiração antes e depois; verifica namespace, hash/ator/payload de replay, revisão e origem; grava versão, referências e estado; compara os efeitos realmente persistidos; remove o fence. `save`, `convert` e `start` têm precondições separadas. Replays leem a versão imutável original e não fazem nova transição, inclusive após salvamentos posteriores. O SQL protege publicação, estado, versões e referências.

O namespace é bidirecional. Os triggers novos sobre `cms_versions` e `cms_state` só bloqueiam novas escritas quando há v2 ativo (ou operationId já reservado por v2). Leituras e replay de recibos v1 continuam disponíveis. A guarda de mídia v2 repete o predicado legado para impedir exclusão ou adulteração de mídia histórica referenciada, inclusive por entrada de carrossel.

## TDD e adversários

`red-all.log`: antes de criar 0009, 10 falhas e um sucesso em cinco arquivos. São falhas de comportamento/schema ausente, não de carregamento de módulo. Uma divergência inicial do harness com comentários após o delimitador foi corrigida usando também a normalização do próprio Wrangler; nenhum tokenizer SQL improvisado foi criado.

A primeira implementação revelou uma diferença real de precedência entre `EXCEPT` e o `UNION` das referências conhecidas; a subconsulta foi isolada antes de comparar conjuntos. Os testes de referência exclusiva e os 300 documentos passaram depois. `red-defensive.log` registrou separadamente a aceitação indevida de campo comercial em mídia via SQL direto, antes de acrescentar a guarda exata de mídia, UUID opcional e navegação; os casos positivos também foram reexecutados.

Cobertura versionada:

- Schema novo vazio, FKs, prontidão e ausência de um trigger; preservação do catálogo; start somente com v1 vazio e carrossel visível.
- Upgrade com duas versões/recibos v1 reais; igualdade dos documentos e referências históricos; save/replay e GET command pelo handler existente; novas escritas v1 bloqueadas após conversão.
- Um vencedor em conversão concorrente e em salvamentos da mesma revisão; replay imutável; conflitos de operationId/hash/payload/namespace; sessão revogada.
- Falhas/IGNORE/revogação dentro de trigger, referências suprimidas ou extras: rollback de versão, referências, estado e fence, sem sucesso parcial.
- Referências no conteúdo e nas entradas; item inexistente ou da categoria errada; mídia inexistente; corrida referência/exclusão; histórico imutável.
- Publicação impedida por INSERT de versões e UPDATE dos campos published em ambos os estados; UPDATE/DELETE de versões, referências e estado recusados.
- Caracterização da cota vitalícia: tombstones deleted contam nos 100 registros; o 101º upload falha sem GC ou relaxamento do limite.

Nenhum teste legado foi alterado. Testes suplementares foram acrescentados durante o desenvolvimento; não se atribui execução vermelha prévia a todos eles.

## Prefixos P1–P5

`cms-v2-prefix-sweep.test.ts` percorre k=0..22, cada um em instância Miniflare nova com UUID e marcador próprio. O baseline de domínio é restaurado de um snapshot imutável criado com login e dois salvamentos v1 reais, antes de instalar os triggers na cópia. O harness confere igualdade da história clonada. Nenhuma instância é reutilizada entre prefixos.

Em cada k: aplica o prefixo; salva v1 pelo repositório real com revisão esperada e sessão válidas; verifica revisão c1, versão, refs, GET command e replay; compara documentos/refs históricos; executa upload válido e exclusão de mídia não relacionada. Antes do fim não há estado/versões/refs v2. No fim, v1 ainda salva, e só a conversão efetiva ativa a supersessão.

O divisor extrai a máquina de estados do Wrangler instalado, mantendo comentários e delimitadores em slices brutos para reconstrução. Executa cada statement pela normalização do mesmo Wrangler, evitando comentário residual interpretado como statement pelo D1. Autotestes cobrem strings escapadas, comentários, CASE/END e trigger; recombinação reproduz o arquivo. Aplicação em um batch completo e aplicação por statement produzem `sqlite_schema` ordenado idêntico.

O controle negativo move o trigger legado antes das tabelas em uma cópia TEMP. Um save v1 real falha por tabela v2 ausente, exatamente a falha que a varredura precisa detectar. Esse controle deliberadamente inseguro não é confundido com falha de um prefixo da migration entregue.

Limite de escopo importante: ainda não existem os handlers/repositório v2 do CP3. O CP2 comprova prontidão/indisponibilidade estrutural e bloqueio da escrita pelo SQL; o helper de laboratório devolve `CMS_SCHEMA_UNAVAILABLE` antes de emitir comandos incompletos. Não se afirma que endpoints v2 inexistentes já retornam HTTP 503, nem se implementa um gateway v2 paralelo. Preview/HTTP e mapeamento de erros são trabalho do CP3.

## Wrangler real e F1–F5

`cms-v2-wrangler.test.ts` cria seis diretórios/bancos novos em TEMP, com `.owner`, IDs aleatórios e configuração local isolada. Executa Wrangler `d1 migrations apply --local`, aplica 0001–0008 aprovadas, faz login e salvamento v1 reais, fecha Miniflare antes do Wrangler e reabre somente o banco descartável do caso. O ambiente dos filhos é filtrado por `childEnv`; nenhum binding remoto é utilizado.

As falhas são injetadas em cópias externas de 0009: F1 após tabelas/índices; F2 durante triggers locais; F3 antes da view; F4 antes da prontidão. Após cada falha: mede objetos retidos/prontidão, compara bytes históricos, salva e repete comando v1 real e verifica recibo anterior. O caso completo converte via SQL e comprova bloqueio de novas escritas v1 e publicação.

| Caso | Exit Wrangler | Objetos novos retidos | Prontidão v2 | Save/replay v1 |
|---|---|---|---|---|
| full | 0 | 22 | True | aprovado |
| F1 | 1 | 0 | False | aprovado |
| F2 | 1 | 0 | False | aprovado |
| F3 | 1 | 0 | False | aprovado |
| F4 | 1 | 0 | False | aprovado |
| F5 | 0 | 22 | True | aprovado |

Na execução final, F1–F4 tiveram rollback integral dos objetos novos (zero retidos) e mantiveram v1 funcional. F5 pelo gerenciador foi no-op com exit 0; execução direta do mesmo DDL foi recusada por objetos existentes, sem alterar os bytes v1. Por já estar completa em F5, a prontidão permanece verdadeira; não seria correto exigir indisponibilidade nesse caso. Os quatro casos quebrados têm exit 1 intencional, conferido pelas asserções. Há hashes separados de documentos, referências e recibo em cada resultado.

Evidências por caso incluem logs CLI, caminho de posse e SHA-256 de documentos, refs e recibo. Os bancos foram mantidos em TEMP para auditoria e encerrados; não são bancos operacionais. `wrangler-results.json` consolida seus caminhos. Atomicidade observada nesse laboratório não é garantia extrapolada para homologação ou ambiente remoto.

## Acoplamento TS ↔ SQL

| Invariante | TypeScript CP1 | SQL 0009 / prova |
|---|---|---|
| Versão | `parseCmsDocument`, schemaVersion 2 | CHECK de valor 2 e json_type integer. SQLite/D1 real identifica 2.0 literal como real; API canônica JSON.stringify produz 2. |
| Slots e identidade | `CMS_RULES_V2`, parser | Primeiro hero, último contact, contagens, IDs únicos, ranks e navegação. |
| Mídia de módulo | `collectMediaRefs`, `content.media.id` | json_tree genérico e extração independente via json_each. |
| Mídia de entrada | `content.entries[].media.id` | Ambos os caminhos no conjunto de refs e comparação EXCEPT nos dois sentidos. |
| Item | `CMS_ITEM_ID_PATTERN`, `entries[].itemId` | Pré-filtro ASCII/128, item existente em catalog_items e category_id='chopes'. Nenhuma regra de preço/volume é copiada. |
| Categoria | ID estável `chopes` | Comparação explícita com a semente da 0005 e consulta D1. |
| Concorrência | Revisões c1/c2, conversão pura | CAS por origem, versão fonte FK, namespace/recibos imutáveis e pós-condições. |

O diferencial determinístico escreve 300 documentos válidos e compara referências TS/SQL; outras 300 inversões estruturais são recusadas por ambos. Há casos independentes de categoria/órfãos/mídia e chaves extras. Isto comprova os acoplamentos registrados, não equivalência integral entre SQL e todas as regras de texto/Unicode do validador puro. A aplicação futura continuará obrigada a validar pelo contrato CP1.

## Graphify e preservação

Skill e consultas query/explain realizadas antes da implementação, com inspeção direta de contratos, validadores, repositório, mídia, catálogo e migrations. O grafo confirma consumidores administrativos e separação do runtime público, mas não enxerga triggers/JSON. A referência existente tem 1421 nós/3595 arestas; seu relatório de ciclos não substitui prova SQL.

Conforme o pedido atual de preservar o grafo, não foi executado update neste CP2. Somente `graphify-out/cache/last_query_stamp` mudou pelas consultas autorizadas; os outros 37 arquivos e todas as configurações permanecem idênticos. Isso é uma distinção explícita em relação à regra genérica de atualização no fechamento da especificação. Nenhuma instalação, hook ou configuração foi alterado.

## Recuperação dos timeouts — diagnóstico controlado

Foram executados os 12 experimentos planejados abaixo, sequencialmente e antes da alteração do harness. O campo de duração é o wall time do processo monitorado, incluindo início e encerramento; os JSONs preservam também a duração de cada teste. Filtros `-t` serviram somente para selecionar os dois casos solicitados no diagnóstico. Não foram acrescentados skip, fixme ou retries.

| Experimento | Workers | Aprovados / falhas | Duração | Pico RSS observado | Pico de processos |
|---|---|---|---|---|---|
| rate-case-w1 | 1 | 1 / 0 | 8.641 s | 511.8 MiB | 4 |
| media-case-w1 | 1 | 0 / 1 | 7.391 s | 502.1 MiB | 4 |
| rate-file-w1 | 1 | 16 / 0 | 31.156 s | 713.9 MiB | 4 |
| media-file-w1 | 1 | 41 / 1 | 7.422 s | 473.9 MiB | 4 |
| legacy-pair-w1 | 1 | 57 / 1 | 36.75 s | 649.6 MiB | 4 |
| legacy-plus-cp2-w1 | 1 | 78 / 2 | 286.36 s | 1042.3 MiB | 8 |
| rate-case-w2 | 2 | 0 / 1 | 7.938 s | 506.1 MiB | 4 |
| media-case-w2 | 2 | 0 / 1 | 7.438 s | 487.5 MiB | 4 |
| rate-file-w2 | 2 | 16 / 0 | 29.797 s | 673.2 MiB | 4 |
| media-file-w2 | 2 | 42 / 0 | 5.453 s | 506.9 MiB | 4 |
| legacy-pair-w2 | 2 | 58 / 0 | 22.297 s | 839.1 MiB | 7 |
| legacy-plus-cp2-w2 | 2 | 80 / 0 | 106.609 s | 1609.4 MiB | 12 |

Os dois casos reproduziram timeout de 5000 ms sem testes CP2, inclusive isolados. Houve também execuções aprovadas, inclusive os 80 testes combinados com CP2 e dois workers, sem mudar código. As fixtures legadas não aplicam 0009; os logs não mostraram falha de asserção funcional nesses casos. Assim, não se atribui o problema a uma mudança semântica do SQL.

A medição nativa Windows amostrou a árvore de processos a cada 250 ms: CPU observada por processo, RSS/private bytes, descendentes, CPU do host e memória física disponível. Foram registrados processos externos com consumo relevante de CPU; nenhum foi encerrado ou alterado. A memória disponível permaneceu elevada (dezenas de GiB), sem evidência de esgotamento de RAM. Não se encontrou compartilhamento de bancos ou diretórios entre os casos: `d1Persist:false` isola as fixtures, cada prefixo usa UUID/runtime próprio e os casos Wrangler usam mkdtemp/owner/configuração/ID próprios.

O monitor distingue processo encerrado por FILETIME e compara nascimento de filho/pai para não confundir PID reutilizado. Um experimento (`legacy-plus-cp2-w1`) teve seus picos de árvore classificados apenas como limite superior porque um CrashReportClient externo antigo foi inicialmente associado por PID ancestral reutilizado. Isso não altera os resultados/durações Vitest; esse pico não fundamenta o ganho de performance. A verificação corrigida não encontrou descendentes de testes ativos ao final dos experimentos. As duas correções foram somente no script de medição TEMP, sem repetir os experimentos concluídos.

Houve sondas adicionais com teto diagnóstico de 15 segundos para observar conclusão dos casos e dos arquivos sem interrompê-los no limiar original. Os arquivos completos aprovaram 58/58 e ambos os casos frios concluíram com asserções aprovadas. Essas sondas não foram utilizadas como gates e não modificaram nenhum arquivo de teste. O gate final usa os timeouts originais de 5 segundos.

### Correção mínima aplicada

Foi comprovado trabalho redundante no novo `cms-v2-sql-fixture.ts`: cada conversão de statement relia o bundle de aproximadamente 15 MB do Wrangler e recompilava a máquina de estados em um contexto VM novo. O cache agora guarda somente as funções puras do parser por instância do módulo no worker. Resultados SQL, snapshots, bancos, sessões e fixtures não são compartilhados pelo cache. O código extraído do Wrangler e os cortes dos statements permanecem os mesmos.

O benchmark chama o código real do helper, usando dez passagens pelos 22 statements. É uma medida específica do parser, não um experimento controlado de duração da suíte inteira:

| Medida | Antes | Depois |
|---|---|---|
| Leituras do bundle | 221 | 1 |
| Bytes lidos | 3321759285 | 15030585 |
| Tempo de parede (s) | 5.7613152 | 0.07783890000000002 |
| CPU observada (s) | 5.938 | 0.094 |
| Pico RSS (MiB) | 160.1796875 | 64.4140625 |
| Pico heap (MiB) | 103.0027084350586 | 11.721824645996094 |

Reconstrução bruta preservada; SHA-256 dos statements canônicos antes/depois: `13e678965135a1ec5e27c9e156f29e01577ab537ec0b966995f0864a471f7306`. SQL 0009 antes/depois: `debc419a6f6ca7f3652d61c7cd82b1f2dab2360da6b7a98e18776f93d8ce5a22`. O cenário mede 221 leituras (3,32 GB) contra uma leitura (15 MB), com aproximadamente 74 vezes menos tempo no parser.

A conclusão é limitada ao que foi demonstrado: os timeouts são sensíveis a inicialização/carga e ocorrem mesmo sem CP2; a duplicação de CPU/I/O do harness CP2 foi removida. Não se afirma que ela foi a causa única de todo timeout anterior ou que a contribuição de cada processo externo foi isolada experimentalmente. A recuperação não altera o SQL para corrigir um problema do executor.

Não foi aplicada correção em testes legados: asserções, corpo, fixtures e timeouts permanecem byte a byte idênticos ao início da recuperação. Portanto não há manifesto adicional de correção legada. Nenhum aumento permanente de timeout foi necessário para a aprovação integral observada após o ajuste do harness.

Artefatos completos em `%TEMP%/chopp-stage4/cp2-recovery/`: `experiments.json`, diretórios dos 12 experimentos com JSON Vitest/amostras/processos, `host-cpu-snapshot.json`, `parser-before.json`, `parser-after.json`, `harness-fix.diff`, `prefix-results.json`, `wrangler-results.json` e logs dos gates.

## Gates finais da recuperação

| Gate | Resultado / exit | Duração |
|---|---|---|
| Typecheck | aprovado / 0 | 1.3 s |
| Biome global | aprovado / 0 | 0.72 s |
| Vitest completo: 1108/1108; 77 arquivos; timeouts originais | aprovado / 0 | 298.92 s |
| Build normal | aprovado / 0 | 2.0 s |
| verify:dist | aprovado / 0 | 0.92 s |
| Build release | aprovado / 0 | 2.59 s |
| verify:release | aprovado / 0 | 0.48 s |
| E2E público: 57/57 | aprovado / 0 | 20.17 s |
| E2E administrativo: 20/20 | aprovado / 0 | 182.45 s |
| E2E release: 20/20 | aprovado / 0 | 178.11 s |
| git diff --check | aprovado / 0 | — |

O Vitest completo foi reexecutado uma vez após a correção real do harness, com `npm test -- --maxWorkers=2`, sem orçamento diagnóstico adicional. Os 22 testes CP2 foram aprovados nessa execução, incluindo os 23 prefixos e os seis cenários Wrangler. Os três E2E foram sequenciais. Todos os logs/exit codes estão em `%TEMP%/chopp-stage4/cp2-recovery/gates.json`.

O bloqueio inicial (1106 aprovados e dois timeouts) permanece documentado nos artefatos da primeira entrega; não foi tratado como aprovação. A rodada atual remove esse bloqueio pelos gates completos acima.

## Riscos e checkpoint

- CP3 não iniciado: não há disponibilidade HTTP v2, preview, carregamento ativo ou tradução HTTP de supersessão. A migration mantém o cabeçote v1 até uma conversão SQL autorizada no laboratório.
- Publicação, editor e homepage permanecem desabilitados/intocados. Não há publicação futura autorizada por este relatório.
- Cota vitalícia de 100 mídias e retenção histórica sem GC continuam bloqueadores de homologação; não foram corrigidas aqui.
- Categoria e IDs foram demonstrados somente em seeds/bancos descartáveis. Bancos mantidos não foram inspecionados.
- Resultados de atomicidade local não substituem homologação futura; a segurança da ordem também foi provada por prefixos sem depender de rollback integral.

**GO técnico para auditoria independente do CP2.** Gates completos aprovados após a correção mínima do harness. Sem alteração de timeout ou teste legado. Isso não autoriza CP3, publicação, staging ou produção.

## Manifesto exclusivo CP2

```text
docs/immersive-cms-stage4-cp2.md
migrations/0009_cms_v2.sql
tests/backend/cms-v2-concurrency.test.ts
tests/backend/cms-v2-media-guard.test.ts
tests/backend/cms-v2-prefix-sweep.test.ts
tests/backend/cms-v2-publication-block.test.ts
tests/backend/cms-v2-schema.test.ts
tests/backend/cms-v2-sql-fixture.ts
tests/backend/cms-v2-upgrade.test.ts
tests/backend/cms-v2-wrangler.test.ts
```

## Git e hashes finais

HEAD e branch preservados; índice vazio. CP1 integralmente idêntico aos hashes consolidados; migrations 0001–0008 e seis arquivos protegidos idênticos. Somente o timestamp de consulta mudou no Graphify; os outros 37 arquivos não mudaram. Nenhuma configuração foi alterada.

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-stage4-cp2.md
?? docs/immersive-cms-stage4-spec.md
?? migrations/0009_cms_v2.sql
?? tests/backend/cms-v2-concurrency.test.ts
?? tests/backend/cms-v2-media-guard.test.ts
?? tests/backend/cms-v2-prefix-sweep.test.ts
?? tests/backend/cms-v2-publication-block.test.ts
?? tests/backend/cms-v2-schema.test.ts
?? tests/backend/cms-v2-sql-fixture.ts
?? tests/backend/cms-v2-upgrade.test.ts
?? tests/backend/cms-v2-wrangler.test.ts
```

Hashes SHA-256 de todos os dez arquivos CP2 em `delivery-hashes.json`; hashes protegidos em `final-protected-hashes.json`; o novo SQL não foi aplicado em banco mantido/remoto. Não houve commit, push, merge, rebase, staging, deploy, publicação ou início de CP3.



## Preservação após recuperação

Manifesto com os mesmos dez caminhos. O delta autorizado é restrito a `tests/backend/cms-v2-sql-fixture.ts` e este relatório; os outros oito arquivos permanecem idênticos, incluindo 0009. Os dois testes legados estão byte a byte iguais aos arquivos anteriores ao diagnóstico. Não há correção legada separada para incluir em commit.

O grafo foi consultado por seus resultados existentes e por leitura do JSON, sem novos comandos Graphify. Dependências de autenticação, catálogo, mídia e repositório foram conferidas diretamente. O AST não representa triggers ou concorrência de runtime. Todos os 38 hashes Graphify permaneceram idênticos, inclusive o timestamp.

Configurações externas, CP0, especificação, CP1 consolidado e migrations 0001–0008 preservados. Índice vazio e HEAD inalterado. SQL 0009 SHA-256: `debc419a6f6ca7f3652d61c7cd82b1f2dab2360da6b7a98e18776f93d8ce5a22`.

Risco residual observado: orçamentos de cinco segundos para integração real são sensíveis a inicialização/carga; a recuperação não promete determinismo de latência em qualquer máquina. Não houve divergência funcional nas execuções que concluíram, e a rodada integral final passou sem relaxar os limites. A contribuição individual da carga externa não foi isolada experimentalmente; as leituras/compilações repetidas do parser foram medidas e removidas diretamente.

# F4A — Etapa 4 / CP4: fechamento técnico do CMS v2

## 1. Escopo, baseline e método

Fechamento exclusivamente documental. Branch `integration/immersive-cms-f4a`, HEAD `f20f777d57b1a20b1c130b21e8c684253023e374`, índice inicialmente vazio. Único arquivo de entrega CP4: `docs/immersive-cms-stage4.md`. Nenhuma implementação, migration, alteração de teste, mudança no Conceito C ou operação remota integra este checkpoint.

Especificação consultada: [immersive-cms-stage4-spec.md](immersive-cms-stage4-spec.md), SHA-256 `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873`. Foram lidos os relatórios CP1–CP3 e confrontados contratos, conversor, validadores, coletores de mídia, repository, handlers, guardas de autenticação, triggers e testes. O grafo foi consultado como evidência auxiliar; relações SQL e caminhos JSON foram conferidos diretamente.

As evidências desta execução ficam em `%TEMP%/chopp-stage4/cp4/`: `gates.json`, logs por gate, snapshots iniciais/finais e consultas Graphify. São artefatos de auditoria fora do repositório, não arquivos de entrega. Evidências históricas são identificadas como históricas; não substituem os gates finais CP4.

## 2. Evidências e consolidação CP1–CP3

| Checkpoint | Commit consolidado | Entrega e evidência histórica | Limite da prova |
|---|---|---|---|
| CP1 | `1b55137ae75b23f0ed2d3aab151ca0446b6e9ecf` | [Relatório CP1](immersive-cms-stage4-cp1.md): 18 arquivos, 45 casos novos; 720 permutações institucionais e 500 documentos v1 válidos convertidos; 1.086 Vitest, E2E 57/20/20 aprovados. | Contrato puro; sem consulta ao catálogo ou R2. Não era prova de persistência/API v2. |
| CP2 | `740180e63d0b94a71a714638e03fec360904fd49` | [Relatório CP2](immersive-cms-stage4-cp2.md): 10 arquivos, migration aditiva 0009, 22 testes; 23 prefixos independentes, controle negativo, diferencial de 300 documentos e F1–F5 em Wrangler. Recuperação encerrou com 1.108 Vitest e E2E 57/20/20 aprovados. | Atomicidade e falhas demonstradas no D1 local emulado; não extrapoladas ao remoto. |
| CP3 | `f20f777d57b1a20b1c130b21e8c684253023e374` | [Relatório CP3](immersive-cms-stage4-cp3.md): 14 arquivos, 20 casos novos, 22 prefixos incompletos também pelos handlers; 1.128 Vitest, E2E 57/21/21 aprovados. | API administrativa real no Pages local, sem consumidor CMS em React e sem publicar. |

CP1 tem demonstração vermelha de 24 falhas em 38 casos e sete casos suplementares; CP2 registra falhas de schema/defesa antes da implementação e a recuperação do parser do harness; CP3 registra 15 falhas comportamentais iniciais e dois testes determinísticos adicionais da janela de replay, antes da correção. Não se atribui TDD retroativo aos casos suplementares que não foram executados vermelhos.

O preflight efetivo de IDs pertence à recuperação CP0 (`%TEMP%/chopp-stage4/cp0-recovery/preflight.json`), não ao primeiro relatório CP0 que terminou NO-GO. Foram consultados nove IDs de seed no D1 descartável: oito na categoria `chopes`, um em `cachacas`, e criado um `item_<uuid>` pela API real. Nenhum foi rejeitado pelo pré-filtro. Bancos mantidos nunca foram inspecionados. No pré-voo CP4, os 14 hashes da entrega CP3 e os nove hashes de migrations corresponderam aos artefatos preservados.

## 3. Matriz de rastreabilidade D1–D6

As regras abaixo são a leitura das decisões na especificação §§4–8; não redefinem suas autoridades ou escopos históricos. C = contrato TypeScript, S = SQL, A = API/repositório. Nomes de testes abreviados nesta matriz correspondem a `tests/backend/`; o E2E está em `tests/e2e-real/admin-real.spec.ts`.

| Decisão e regra aprovada | Arquivos responsáveis por camada | Evidência de teste | Garantia efetivamente demonstrada | Limites e riscos residuais |
|---|---|---|---|---|
| **D1 — slots fixos, instituições reordenáveis.** `Hero → Carousel? → Ticker? → Catalog → Inst{0..6} → Contact`, ranks não decrescentes e cardinalidades estritas. | **C:** `shared/cms/v2.ts:80`, `server/cms/validation-v2.ts:57`. **S:** `0009_cms_v2.sql:76` (forma, ordem, identidades/navegação). **A:** valida documento antes de emitir comando. | `cms-v2-contract.test.ts:41` (720 permutações), `:51` (cruzamentos); `cms-v2-media-guard.test.ts:9` (300 documentos e inversões); schema/API. | Aceita permutações institucionais válidas e recusa cruzamento de slots, hero fora do início, contact fora do fim e excessos. A persistência não permite escolher uma composição arbitrária fora das guardas. | Não existe renderização CMS. Menu, âncoras, numeração e visibilidade React ainda não são derivados do documento. SQL é defesa estrutural, não substituto integral do validador de texto/Unicode. |
| **D2 — início explícito com carrossel visível; conversão sem inventar conteúdo.** Ausência de barrels em v1 não cria carousel artificial. | **C:** `validation-v2.ts:120`, `convert.ts:11`. **S:** comando `0009:152`, condição start em `:161`. **A:** `commands.ts`, `repository.ts:327`, `functions/api/admin/site/convert.ts:1`. | `cms-v2-contract.test.ts:127`; `cms-v2-conversion.test.ts:6`; `cms-v2-schema.test.ts:43`; `cms-v2-api.test.ts:6,128`. | Start só em CMS vazio e com carrossel visível; conversão somente de rascunho v1, calculada no servidor, preview sem escrita e commit igual ao preview para a mesma revisão. Ausência/ocultação/entries vazias produz avisos previstos, sem inventar produtos/imagens. | Draft pode ter entries vazias; start não é publicação. Conversão sem carrossel exige futura integração condicional do botão do Hero. `losses=[]` é a situação atual; perdas futuras exigirão novos testes e confirmação. |
| **D3 — conversão total e conservação das referências de mídia.** `barrels.media → carousel.media`, inclusive alt, nulo e módulos ocultos. | **C:** `convert.ts:22`, `media-refs.ts:2`, `media-contract.ts:38`. **S:** `0009:101` (duas extrações), `:123` (refs), `:142` (guarda histórica). **A:** conversor e validação de mídia antes/na persistência. | `cms-v2-conversion.test.ts:6` (500 documentos válidos); `cms-media-refs.test.ts:10,23`; `cms-v2-media-guard.test.ts:57`; segurança HTTP `:172`. | Preserva IDs, textos, mídias e ordem relativa institucional, sem mutar a entrada. Coleta os dois caminhos conhecidos, deduplica e ordena; SQL compara os conjuntos e protege refs v1/v2 históricas. Mídia ausente/deleting/deleted é recusada. | Referências não ready podem existir em rascunho, por regra aprovada; GET avisa. `publicationMediaErrors` verifica inventário/metadados, não disponibilidade permanente ou bytes remotos. Função visual de `carousel.media` continua indefinida. |
| **D4 — associação editorial por itemId estável; catálogo é autoridade comercial.** Pré-filtro ASCII/128 e existência em `catalog_items`, categoria `chopes`. | **C:** `shared/cms/v2.ts:79`, `validation-v2.ts:106`. **S:** `0009:100`. **A:** `repository.ts:171` (avisos), `handlers.ts:16` (400 de item/mídia). | Preflight CP0 recuperado; `cms-v2-media-guard.test.ts:9,57,106`; `cms-v2-security.test.ts:108`; E2E Pages `admin-real.spec.ts:866`. | IDs conhecidos passam; item ausente ou de categoria diferente é recusado na escrita. Item posteriormente ausente/oculto gera aviso sem reescrever história. Catálogo permanece igual antes/depois; não são copiados preços, volumes ou variantes ao CMS. | Formatos/estado de IDs de bancos mantidos não foram verificados. Pré-filtro não prova existência. Avisos não são autorização de publicação; renderização futura precisa respeitar visibilidade comercial atual. |
| **D5 — conversão transacional, idempotência e concorrência com preservação v1.** Uma transição por comando, revisões c1/c2 e recibo original. | **C:** primitivas de revisão e intent estrita. **S:** `0009:45,51,131,137,152,174` e 0006 preservada. **A:** `repository-v1.ts:56`, `repository.ts:55,217,235,248,295,327,378`; handlers e rotas privadas. | `cms-v2-upgrade`, `cms-v2-concurrency`, `cms-v2-api` (replays após edições, corrida com save v1 e intercalações `:239`), `cms-v2-http`, `cms-v2-security:92`; E2E `:866`. | v1 opera antes da conversão e nas instalações parciais; SQL bloqueia novas escritas v1 depois, mas mantém história/recibos legíveis. Mesma operação retorna o registro persistido; alterações de hash/ação/ator ou revisão conflitante são recusadas. Sessão revogada e falhas SQL abortam; resultado perdido pode ser recuperado sem duplicar efeitos. | Prova transacional local não é transação distribuída com R2 nem comprovação remota. Conta F2 é única: defesa de ator divergente foi testada por injeção controlada do resultado de leitura, sem inventar administração multiusuário. |
| **D6 — proteção permanente de mídia histórica e caracterização da cota vitalícia.** Sem GC ou reparo silencioso nesta etapa. | **C:** refs legadas delegadas ao coletor único. **S:** 0006/0007/0008 intactas; `0007:26,36`, `0009:61,66,123,142`. **A:** biblioteca existente mantém proteção por referência e mapeia exclusão conflitante. | `cms-v2-publication-block.test.ts:4`; `cms-v2-media-guard.test.ts:134,165`; `cms-v2-security.test.ts:172`. | Update/delete de referências históricas e exclusão de mídia referenciada são bloqueados; corrida referência × exclusão não deixa versão pendurada. Tombstones contam no total de 100, e o 101º upload é recusado. | **Bloqueador de homologação:** a cota não se recupera pela exclusão. Política de retenção/GC e evolução da capacidade não existem; só podem ser propostas para etapa posterior, preservando histórico e sem apagamento automático. |

## 4. Registro de acoplamento TS ↔ SQL e prontidão

| Interface | Contrato/validação | Persistência e API |
|---|---|---|
| Versão | Despacho por número 1/2, sem coerção; 2.0/2e0 vira número 2 em JSON. | SQL exige valor 2 e integer na forma armazenada. Aplicação persiste JSON canônico; não confundir literal SQL 2.0 com a forma canônica produzida pela API. |
| Slots e identidade | IDs fixos hero/catalog/contact; UUIDs opcionais; rank, navegação e cardinalidade. | Guardas de INSERT replicam a estrutura; diferencial de 300 documentos e inversões testa os acoplamentos registrados, não todas as regras Unicode. |
| Mídia | `content.media.id` e `content.entries[].media.id`; collector único, inclui ocultos. | `json_tree` genérico confrontado com extração independente `json_each`/EXCEPT nos dois sentidos; FK e refs imutáveis. |
| Produto | `entries[].itemId`, pré-filtro `CMS_ITEM_ID_PATTERN`. | Existência e categoria `chopes` no mesmo comando SQL. Não usa o rótulo "Chopes" nem duplica dados comerciais. |
| Comando | Action, operação, revisão, documento canônico e acknowledge ordenado. | `origin_kind=save/convert/start`, fonte v1 imutável, prova de sessão antes/depois e conferência do resultado persistido. |
| Disponibilidade | Repositório consulta `sqlite_schema`, depois a view de readiness, só então objetos v2. | `cms_ready_v2` é o último statement e exige ledger, tabelas, catálogo e todos os triggers por nome. Prefixos incompletos deixam v2 indisponível, não quebram v1. |

A 0009 contém 22 statements de topo, quatro tabelas, dois índices, 14 triggers e duas views. O divisor reutiliza a máquina de estados do Wrangler instalado; preserva strings, comentários, CASE/END e corpos de trigger, com autotestes de recomposição e equivalência de schema. Não foi criado parser improvisado no CP4.

Os testes CP2 cobrem **23 bancos/prefixos independentes k=0..22**, inclusive controle negativo de ordem insegura. CP3 acrescenta **22 instalações incompletas k=0..21** exercitadas por HTTP: GET/PUT v1 e recibos preservados; preview, convert, start e save v2 retornam 503 `CMS_SCHEMA_UNAVAILABLE`. Com instalação completa ainda sem conversão, v1 funciona; após conversão, o bloqueio de novas escritas v1 é legítimo.

### Demonstração Wrangler F1–F5

| Caso | Exit Wrangler observado | Objetos novos retidos | Prontidão v2 | Save/replay v1 e recibo anterior |
|---|---:|---:|---|---|
| full | 0 | 22 | Sim | Preservados |
| F1 | 1 | 0 | Não | Preservados |
| F2 | 1 | 0 | Não | Preservados |
| F3 | 1 | 0 | Não | Preservados |
| F4 | 1 | 0 | Não | Preservados |
| F5 | 0 | 22 | Sim | Preservados |

Resultados **novos desta execução CP4**, não somente reuso do relatório CP2: `wrangler-results.json` foi copiado da evidência `chopp-cp2-wrangler-evidence-TaQaAj`; `prefix-results.json`, da `chopp-cp2-prefix-evidence-zuGoJN`. Esta última confirma 23 prefixos, k=0..22, com salvamento/replay/recibo v1 preservados. O teste de controle negativo também integra o Vitest aprovado.

F1–F4 observaram rollback integral dos objetos novos (zero retidos); v2 ficou indisponível e v1 permaneceu funcional, com bytes históricos conferidos. Full e F5 mantiveram os 22 objetos e prontidão verdadeira; replay v1, supersessão após conversão e bloqueio de publicação passaram. Hashes separados de documentos, referências e recibos estão nos resultados por banco. A atomicidade observada no Wrangler/Miniflare **não comprova** atomicidade no Cloudflare remoto; a prontidão e a ordem dos objetos continuam necessárias para instalação incompleta.


Falhas em F1–F4 são injetadas somente em cópias temporárias da migration. Exit 1 nesses quatro casos é esperado e assertado, não um gate ignorado. F5 distingue reaplicação pelo gerenciador (no-op) de execução direta do DDL já existente (recusada). Os bancos possuem marcadores `.owner`, config/IDs próprios e `--local`; não são bancos mantidos.

## 5. Segurança, compatibilidade e divergências

- **CMS v1:** validador e funções Unicode preservados. No CP4 foram repetidas as comparações literais de containsControls, malformedUnicode, unsafeUnicode, validateCmsDocument, validateCmsMutation e projectPublicCms contra o baseline efe492b; as seis correspondem (`v1-verbatim-functions.json`). O corpo atual de `repository-v1.ts` foi novamente comparado com `efe492b:server/cms/repository.ts` (renomeação da exportação apenas) e corresponde. História e recibos são protegidos em SQL; novos saves v1 só deixam de ser permitidos após supersessão explícita.
- **Sessão/origem/CSRF:** handlers usam `requireAdmin`; prova `adminWriteProof` repetida no comando SQL. Testes cobrem origem inválida, sessão ausente/revogada antes e durante a transação, rollback e leitura de recibos autorizada. Sem mudança de auth, limites de corpo/tempo ou critérios de erro.
- **Resposta/idempotência:** lookup por operação nas duas versões; respostas derivadas da versão imutável persistida. A janela entre lookup e cabeçote foi corrigida no CP3 e possui dois testes determinísticos. Replays não recebem o documento mais recente nem avisos dinâmicos. Ausência de If-Match: 428; formato divergente: 400; revisão/schema conflitantes: 409. Incapacidade de conferir persistência: 503, sem sucesso presumido.
- **Publicação:** os contratos têm tipos/modo `publish` e projeção pura, intencionalmente futuros. Isso **não habilita** publicação. Handler permite saveDraft, repository recusa publicação e triggers impedem `kind='published'`/ponteiros publicados em v1 e v2. `published` continua null. Não existe rota pública CMS e a projeção não é consumida pela homepage.
- **Privacidade:** DTOs de resposta são allowlisted; sem objectKey, manifesto, command_hash, ator ou sessão. Metadados de referência editorial não são URLs de bytes privados. Nenhum binding remoto foi conectado.
- **Conceito C:** nenhum diff em `src/` entre o baseline da Etapa 4 `efe492b` e o HEAD CP3, nem mudanças no CP4. `LandingPage.tsx:17` usa `useCatalog`; a composição permanece fixa. Busca direta e grafo não mostram import/consumo CMS pela homepage. Preservação de fonte e testes públicos não são apresentados como nova aprovação visual independente.

Divergências/ajustes documentados, sem correção nesta rodada:

| Ponto | Especificação literal versus implementação | Classificação |
|---|---|---|
| DTOs legados | A pseudodefinição sugere redefinir CmsDocument/CmsAdminSnapshot. A transição autorizada no CP1 conservou nomes/DTOs legados e acrescentou CmsAnyDocument/CmsVersionedAdminSnapshot; GET ativo usa schema null/1/2. Recibos v1 continuam no formato original, também depois da conversão. | Ajuste de compatibilidade registrado em CP1/CP3; evita alterar recibos imutáveis. Não equivale a ausência de suporte v2. |
| Comentário da fachada | `shared/cms.ts:1` ainda menciona a transição futura CP3; o runtime atual já usa a união versionada no GET. | Comentário temporalmente desatualizado; registrado sem editar código. |
| Mídia draft não ready | Salvamento não exige ready, mas rejeita deleting/deleted/ausente e GET emite aviso. | Refinamento explicitamente aprovado nos §§5/10 para conversão total; não autorização de publicação. |
| IDs na conversão | Conversor não usa operationId para fabricar IDs; preserva IDs dos módulos. | Refinamento aprovado; IDs de versão/revisão são novos e pertencem ao comando, não ao conteúdo. |
| Uma view de comando | save/convert/start usam `cms_v2_write` com origem discriminada. | Refinamento aprovado, sem arquitetura paralela. |
| Atualização Graphify | CP4 consulta o grafo existente por cópia temporária; não executa update. | Fechamento documental, sem alteração AST; preserva o grafo/configurações e a restrição atual de entregar apenas o relatório. |

## 6. Estado arquitetural Graphify

Skill consultada em `C:/Users/zzzzz/.claude/skills/graphify/SKILL.md` e referência de query. Os termos selecionados do vocabulário real foram cms, repository, validation, convert, media, session, handlers, landing, catalog, refs, command e unicode. CLI query/explain executados contra cópia byte a byte de `graphify-out/graph.json` em TEMP; caches operacionais das consultas ficam somente nessa cópia. Não houve update, extração, instalação, mudança de hooks ou configuração.

Grafo existente: **1.503 nós, 3.919 arestas e 85 comunidades**. O JSON global é não direcionado; a análise reconstrói as direções source/target das relações de importação. Não foi encontrado ciclo no subgrafo dirigido de imports/reexports/dynamic imports. Dependência confirmada: rota privada → handlers → validação/comandos/repositório → auth, conversor e referências; repositório delega v1 ao módulo preservado e v2 ao comando SQL. Nenhuma dependência CMS foi alcançada a partir de LandingPage. Fonte `server/cms/repository.ts:L42` e handlers `:L1` foram conferidos diretamente.

O metadado do grafo indica commit `740180e6`, porque a atualização ocorreu com os arquivos CP3 ainda não commitados. Isso foi exposto, não tratado como frescor por HEAD: os hashes dos arquivos CP3 correspondem à entrega que gerou o grafo e ao commit atual f20f777. Os **41 arquivos originais do Graphify** foram inventariados para comparação final. A cópia temporária e seus caches não fazem parte da entrega.

Limites: nove SQLs não extraídos por falta de `tree_sitter_sql`, CSS/alguns arquivos sem símbolos e relações inferidas no grafo. SQL, caminhos JSON, visibilidade de produtos e comportamento de rede não são provados pelo grafo. Não se recalculou coesão ou extração semântica; o relatório existente registra 0 tokens externos de entrada/saída e o CP4 não chamou modelo semântico. Provas de runtime vêm dos gates abaixo.

## 7. Gates finais CP4

Todos os gates finais foram reexecutados no HEAD f20f777 e aprovados. Nenhuma falha ou teste pendente foi desconsiderado. Vitest e as três suítes E2E executaram sequencialmente, sem alterar timeouts ou repetir testes até obter aprovação.

| Comando | Exit code | Duração (s) | Resultado |
|---|---:|---:|---|
| `npm run typecheck` | 0 | 1.06 | Aprovado |
| `npm run lint` | 0 | 0.55 | 38 warnings e 13 infos preexistentes; sem erros/fixes |
| `npm test -- --maxWorkers=1` | 0 | 618.22 | 1.128/1.128 testes; 80/80 arquivos |
| `npm run build` | 0 | 2.14 | Aprovado |
| `npm run verify:dist` | 0 | 0.88 | Aprovado |
| `npm run build:release` | 0 | 2.55 | Aprovado |
| `npm run verify:release` | 0 | 0.47 | Aprovado |
| `node %TEMP%/chopp-stage4/cp4/public-runner.mjs` | 0 | 22.30 | 57/57; produção normal, porta 4212 |
| `npm run test:e2e:real` | 0 | 193.22 | 21/21; porta 4213; Pages e D1 próprios |
| `npm run test:e2e:release` | 0 | 192.06 | 21/21; porta 4214; inclui o fluxo CMS v2 |
| `git diff --check` | 0 | — | Sem erros de whitespace |

Logs integrais e comandos em `%TEMP%/chopp-stage4/cp4/gates.json` e `<gate>.log`. O Vitest desta rodada inclui os 45 casos CP1, 22 CP2 e 20 CP3, além dos legados; as contagens de documentos/permutação/prefixos são cenários internos desses testes, não testes adicionais somados artificialmente ao total. Não houve retries ou filtros no Vitest completo. O source dos testes e configurações permaneceu byte a byte igual ao pré-voo.


A configuração pública temporária seleciona todos os 57 testes públicos usados no CP3, com produção normal e D1 próprio, sem usar o webServer padrão que escreve em `.wrangler/e2e-state`. As suítes administrativas reais/release exercitam integralmente seus 21 testes, incluindo o novo caso CMS via Pages. Testes de painel mock não são apresentados como administração real. Não se alteraram timeouts, assertions, retries, fixtures ou código para produzir aprovação.

## 8. Pendências obrigatórias e limites de prontidão

| Pendência | Situação/risco atual | Condição futura para remover a pendência, sem implementação no CP4 |
|---|---|---|
| **Cota vitalícia de 100 mídias** | **Bloqueador de homologação** exigido pela spec. Conta todos os registros, inclusive tombstones; excluir não devolve capacidade. | Definir capacidade/cota sustentável, aprovar evolução e caracterizá-la com testes. Não afrouxar a guarda silenciosamente. |
| Retenção/GC | Histórico e refs têm proteção permanente. Não existe GC; remoção automática ameaçaria integridade/auditoria. | Propor política de retenção com aprovação explícita, rastreabilidade e verificação de referências de todas as versões. Nenhum reparo ou purge automático foi executado. |
| `carousel.media` | Preservada como referência editorial, sem função visual definida. | Decisão de design/contrato antes de renderer/editor; sem assumir que seja fundo, imagem de produto ou primeiro barril. |
| Ordem editorial, menu e âncoras | React usa `nav-links.ts` estático, composição fixa e âncoras próprias. `CMS_RULES_V2` já define suas âncoras, mas elas não foram integradas. | Derivar menu/âncoras de módulos efetivamente renderizados e visíveis, preservando acessibilidade e evitando links sem alvo. Harmonizar `inicio` do contrato com `topo` do React. |
| Numeração e botão do Hero | Rótulos 01–05 são fixos; Hero tem link incondicional `#barris`. CMS permite conversão sem carrossel/oculto. Hoje isso não interfere porque não há consumo CMS. | Ajustar numeração à ordem visível e condicionar o link do Hero à existência do alvo na futura integração, preservando Conceito C. |
| Editor visual F4A.4 | Inexistente nesta etapa; backend privado e contratos não constituem editor. | Especificar e auditar edição, preview e recuperação de conflitos sem duplicar fontes de verdade. Nenhuma tela foi criada. |
| Publicação/renderização pública | Deliberadamente bloqueadas; projeção é função pura sem endpoint/consumidor. | Etapa autorizada separada, com revalidação de catálogo, mídia/R2 e sessão no ponto de publicação; análise de cache, revisão publicada e rollback. |
| Cloudflare isolado | Não houve staging/deploy, D1/R2 remoto ou verificação de bindings remotos. Atomicidade observada é local. | Ambiente isolado com autorização específica, validação de migrations/falhas, concorrência e objetos; nunca extrapolar o resultado local a banco mantido. |
| IDs de bancos mantidos | Não inspecionados. Compatibilidade demonstrada somente para seeds e IDs gerados no laboratório. | Preflight autorizado sobre dados do ambiente alvo, antes de promover a migration, sem presumir compatibilidade de toda a base. |
| Exaustão de portas e carga local | CP3 documentou EADDRINUSE com ~17,6 mil conexões TIME_WAIT; CP2 documentou sensibilidade dos testes de 5 s à inicialização/carga. | Isolar execuções e monitorar recursos; nesta rodada um worker Vitest e E2E sequenciais, sem sobreposição. Não mascarar com retries ou aumento de timeout. |

Essas pendências não são novas funcionalidades prometidas ou implementadas. A cota vitalícia e a validação remota pendente impedem tratar este fechamento como homologação operacional; editor e consumo público continuam fora do escopo da Etapa 4.

## 9. Estado Git, hashes e veredito

HEAD final `f20f777d57b1a20b1c130b21e8c684253023e374`, branch `integration/immersive-cms-f4a`, índice vazio. Comparados 365 arquivos rastreados com hashes do pré-voo: **todos idênticos**. Os 14 arquivos CP3 correspondem também ao manifesto/hash auditado anterior. Nenhum código, teste, configuração, relatório CP1–CP3 ou migration foi modificado. Os 41 arquivos originais de Graphify têm exatamente os mesmos caminhos e hashes; consultas e caches temporários não alteraram o grafo original.

Único delta CP4 em relação ao estado inicial: **arquivo novo não rastreado `docs/immersive-cms-stage4.md`**. As alterações preexistentes permanecem, sem restaurar, formatar, apagar ou preparar no índice. `.claude/settings.local.json` segue ignorado e preservado.

| Arquivo protegido | SHA-256 inicial = final |
|---|---|
| `.gitignore` | `8e50a25a8e259b2912835c6a77a1b03dfd0558e24315c1d1470a5972af587668` |
| `.claude/settings.json` | `f4e5f81ee806e3792a2c9c57285c1ce009be083019f42ac8e435bd4790ab8b2a` |
| `.claude/settings.local.json` | `21dcff94caa79881e580b87945186af2bd9c54ada5665497196b9bd835f9f816` |
| `CLAUDE.md` | `55189e0bb8f83d9de53de3142fc8702c6ec45d01df3478da4b8224cb0d20d83c` |
| `docs/immersive-cms-stage4-spec.md` | `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873` |
| `e2e/catalog-atomic-routes.spec.ts` | `0abbe95a5ac242093f8f4227aa321577a7a2ddd6b9c18157a78aaae1b64c5985` |

| Migration intacta | SHA-256 inicial = final |
|---|---|
| `migrations/0001_catalog.sql` | `c67165df086792858a2de7ca64924200291e25e9840a644c087a41f94a3af2cf` |
| `migrations/0002_catalog_seed.sql` | `41c2300cadbbc87dd4f06fdcecb75795e651e337af9b8cc334da2a57942ca8ad` |
| `migrations/0003_admin_auth.sql` | `fbf4b148c26341b701616875b2f0954aa2f7eb120266564b523b715af2886cfd` |
| `migrations/0004_catalog_revision.sql` | `76d4191f3f14706c80b4baa0e347686c207ccc8d4076ab772e8054bb731f1e98` |
| `migrations/0005_catalog_expansion.sql` | `21d825fa1b76cb62242cf7a11d359eb02c2a91bff1870f45e42c9464bcb418a4` |
| `migrations/0006_cms_foundation.sql` | `7b5c529a8e18763cc7804317a430ba1af1390704b3ce56616fecc5d358470e14` |
| `migrations/0007_cms_media_local.sql` | `d0db48ec65f1adf07d5907ae62873d6755a9916f04a93e10fb97f98382ae8ad9` |
| `migrations/0008_cms_media_atomic.sql` | `54dde3988f94bf642c6c0bff2efddc50ed7424ab50eddfae94ba53e26259aa83` |
| `migrations/0009_cms_v2.sql` | `debc419a6f6ca7f3652d61c7cd82b1f2dab2360da6b7a98e18776f93d8ce5a22` |

Estado final (`git status --short --untracked-files=all`):

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-stage4-spec.md
?? docs/immersive-cms-stage4.md
```

Inventários completos em `initial-tracked-hashes.json`, `initial-graph-hashes.json`, `protected-hashes.json` e `final-preservation.json` no diretório TEMP CP4. O último registra também o SHA-256 deste relatório, sem circularidade dentro do próprio documento.


**GO técnico para auditoria independente do CP4.** A rastreabilidade D1–D6 está documentada, os gates finais passaram e não foi identificado bloqueador do fechamento documental/local. A cota vitalícia de 100 mídias permanece **bloqueador de homologação**; retenção/GC, integração visual, publicação e validação Cloudflare isolada seguem pendentes conforme a matriz acima.

Este veredito não autoriza homologação, staging, produção, consolidação por commit ou próxima etapa. Nenhum commit, push, merge, rebase, staging, deploy ou migration em banco mantido/remoto foi executado. Publicação segue bloqueada, editor e homepage não foram integrados. CP4 encerrado para auditoria independente.


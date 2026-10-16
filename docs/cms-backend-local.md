# F4A.1 — backend CMS modular, exclusivamente local

Base: branch `integration/delegas-f3`, HEAD
`fc5bc3052c114bb07f2c742ae2a4321f47f8894c`. Preflight: árvore limpa, staging vazio,
branch/HEAD exatos. Esta etapa implementa somente estado administrativo e rascunhos.
Não publica conteúdo, não acrescenta API pública, prévia, editor, upload R2,
promoções, mudanças de design ou mudanças comerciais.

## Pendências L0A.2 corrigidas

- **P2, pontuação:** os exemplos `Horário: 18h às 23h`, `Atendimento: segunda a
  sábado`, `Delegas: delivery de chope` e `Horário:18h` são aceitos. O filtro não
  interpreta todo token seguido de dois-pontos como esquema. Continua recusando
  HTML, esquemas perigosos conhecidos, URLs hierárquicas, `//` e `www.`. Texto é
  dado inerte: esse filtro não é um sanitizador de linguagens nem garantia de
  conformidade comercial; nenhuma URL é convertida em link/fetch pelo backend.
  A representação usada só pelo detector remove ignoráveis Unicode e TAB/CR/LF,
  recusando `java\nscript:`, `da\tta:` e `vb\rscript:` sem remover quebras do texto
  persistido. Limites de palavra evitam confundir `Metadata:` com esquema `data:`.
- **P3, materialização:** o documento e o envelope são serializados/parseados antes
  da validação. Somente a representação materializada é validada e devolvida.
  Getters/toJSON não são lidos novamente para conferir outro objeto. O repositório
  revalida/copia o comando e fixa JSON canônico e hash antes de usá-los no SQL.
  Regressões incluem getters que mudam entre chamadas, toJSON inválido/válido,
  ciclos e valores sem representação JSON. Não há eval de conteúdo.
- **P3, linha única:** títulos, perguntas, títulos dos passos, ticker e alt recusam
  CR/LF/TAB, controles Unicode e separadores de linha/parágrafo. Corpo, resumo,
  introdução e respostas continuam multilinha; controles perigosos não são aceitos.
- **P3, JPEG:** o laboratório percorre segmentos e scans, distinguindo EOI de bytes
  semelhantes dentro de APP. Recusa JPEG concatenado e payload após o primeiro EOI
  mesmo quando termina com outro EOI. Contraexemplos: APP com bytes EOI e JPEG
  progressivo com múltiplos scans são aceitos e decodificados. São agora **27
  verificações locais**, preservando os 23 cenários anteriores. O teste que conta
  cenários passou de 23 para 27 para exigir as novas regressões, sem removê-las.

Os testes de hardening reproduziram 12 falhas antes da correção dos validadores.
A revisão adversarial interna identificou o caso das URIs fragmentadas em corpo
multilinha; três regressões e um contraexemplo editorial falharam antes do ajuste
final e passaram depois. Nenhuma asserção de segurança foi removida.
Detalhes/histórico L0A.2 continuam em [cms-contracts.md](cms-contracts.md) e
[cms-media-proof.md](cms-media-proof.md). Este documento atualiza o comportamento
de serialização, texto e persistência daqueles contratos conceituais. O resultado
Miniflare continua sendo prova offline, sem compatibilidade remota comprovada.

## Contratos HTTP

Todos os endpoints usam autenticação F2 real, configuração de origem e usuário
ativo. Leituras reavaliam a sessão no D1; escritas usam o guard CSRF e prova SQL.
Respostas têm `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` e
`X-Frame-Options: DENY`. Nenhum endpoint cria sessão ou contorna F2.

| Endpoint | Entrada | Resposta de sucesso |
| --- | --- | --- |
| GET /api/admin/site | Cookie administrativo | 200, CmsAdminSnapshot e ETag forte da revisão do draft |
| PUT /api/admin/site/draft | Cookie, Origin/Referer válido, If-Match forte, JSON CmsMutation com action=saveDraft | 200, CmsCommandResult e ETag da revisão gravada no recibo |
| GET /api/admin/site/commands/:id | Cookie, UUIDv4 canônico | 200, o MESMO CmsCommandResult da operação original, ou 404 se não houver recibo do ator |

Estado inicial: `{ draft: { revision: 'c1_<UUIDv4>', document: null }, published:
null }`. GET não inicializa nem escreve: a migration cria somente essa metadata.
Não há seed de textos, número comercial ou conteúdo publicado.
`CmsAdminSnapshot.draft.document` agora pode ser null antes da primeira gravação.

PUT recebe exatamente `{ action: 'saveDraft', expectedRevision, operationId,
document }`. O header precisa ser `"c1_<UUIDv4>"`, forte, único e igual ao token do
corpo. UUIDs são minúsculos canônicos, revisão gerada no servidor. Wildcard, tags
fracas/múltiplas, número de revisão do catálogo, campos extras e action=publish
são recusados. Rascunhos incompletos seguem as regras L0A.2: textos vazios, número
null e Hero sem mídia são permitidos, mas estrutura/composição/segurança já valem.

`CmsCommandResult`:

```typescript
{
  command: { operationId, action: 'saveDraft', expectedRevision, revision, versionId },
  site: { draft: { revision, document }, published: null }
}
```

O resultado é um recibo imutável daquela gravação, não promessa de que a revisão
continua atual. Depois de replay/recuperação, GET /site é a fonte do estado atual.
O corpo não expõe command_hash, actor_id, sessão, timestamps internos, chaves R2
ou erros SQL. Repetir a operação com a mesma intenção não gera versão nova.

Erros estruturados `{ error: { code, message, fields? } }`:

| Situação | Status / código |
| --- | --- |
| Sessão ausente, inválida, revogada, expirada, versão divergente ou usuário inativo | 401 UNAUTHENTICATED |
| Origem de escrita não permitida/cross-site | 403 INVALID_ORIGIN |
| Método incompatível | 405 METHOD_NOT_ALLOWED e Allow |
| If-Match ausente | 428 PRECONDITION_REQUIRED |
| Header malformado/ID inválido | 400 INVALID_REQUEST |
| Contrato inválido/action proibida/revisão header-corpo diferente | 400 VALIDATION_ERROR |
| Corpo malformado/UTF-8 inválido/tipo incorreto | 400 INVALID_BODY |
| Corpo além de 66.560 bytes | 413 BODY_TOO_LARGE |
| Leitura do corpo além de 5.000 ms | 408 READ_TIMEOUT |
| Revisão obsoleta / ID reutilizado com outro conteúdo ou ator | 409 CMS_REVISION_CONFLICT / CMS_OPERATION_CONFLICT |
| Mídia inexistente/deleting/deleted | 400 CMS_INVALID_MEDIA |
| UUID de comando não encontrado para o ator | 404 CMS_COMMAND_NOT_FOUND |
| Schema/histórico inconsistente, indisponibilidade ou pós-condição inválida | 503 CMS_UNAVAILABLE |

O corpo é lido por chunks, com limite de bytes reais e cancelamento no excesso ou
prazo; Content-Length não é autoridade. Limite do envelope = limite documental
65.536 + 1.024 bytes de overhead. JSON de documento ainda tem seu próprio teto.
Não são usados os leitores F2/F3 para evitar modificar seus comportamentos.

## Migration 0006 e invariantes

`migrations/0006_cms_foundation.sql` é aditiva. As migrations 0001–0005, schema e
contrato comercial não mudam. O ensaio ocorre em Miniflare sem persistência e nos
diretórios TEMP descartáveis já usados pelos testes Wrangler/Pages; não executar
`db:init` sobre o banco mantido para testar esta entrega.

| Tabela | Invariantes implementadas |
| --- | --- |
| cms_state | Singleton; token inicial aleatório; FK RESTRICT para versões; versão/revisão do draft coerentes com a revisão anterior; DELETE proibido; ponteiros públicos permanecem null |
| cms_versions | Snapshot e recibo na mesma linha; IDs e revisões únicas; operation_id UNIQUE; JSON objeto v1, máximo de bytes; SHA-256 de comando; ator FK; timestamps SQL; UPDATE/DELETE proibidos; somente kind draft nesta fase |
| cms_media | Estados enumerados, ID/chave de quarentena únicos, manifesto JSON opcional e obrigatório em ready, lease/timestamp pareados; sem conteúdo binário e sem produtor/upload |
| cms_media_refs | Relação por versão/media_id, PK composta, FKs RESTRICT, índice reverso; refs de versões retidas são imutáveis |

Índices: versões por criação/ID, mídia por estado/lease/criação e referências por
mídia/versão, além de PK/UNIQUE. `cms_ready` verifica histórico 0006, quatro tabelas
e nove triggers exigidos. Schema parcial não pode ser usado como sucesso vazio.
`cms_draft_write` é uma view de comando; sessão/origem transitórias não são
armazenadas no snapshot/recibo. Não existe tabela adicional de operação.

F4A.1 deliberadamente bloqueia publicação também em triggers. Uma futura fase
deverá mudar esses guards explicitamente; não é suficiente preencher um ponteiro.
A tabela de mídia é fundação: o manifesto ainda não é um upload validado. Validação
completa dos derivados e estados de publicação continua pendente da fase de mídia.

### Escrita atômica e sessão vigente

O repositório usa `adminWriteProof` no WHERE da operação de comando. O trigger
confere novamente sessão, usuário ativo, origem, auth_version e expiração no início
e no final. Não depende somente da leitura anterior do guard.

Um único comando protegido executa: checagem de schema/sessão; checagem de replay;
CAS de revisão para operação nova; INSERT do snapshot/recibo; INSERT deduplicado de
refs; recusa de mídia em exclusão; avanço do estado; pós-condições e autorização
final. Um erro aborta todo o comando, inclusive recibo e alterações de outros
triggers no mesmo statement. Leituras de recibo e autorização usam o mesmo batch.

As [batches do D1 são transacionais](https://developers.cloudflare.com/d1/worker-api/d1-database/).
O código não trata UPDATE que afeta zero linhas como sucesso: a prova de sessão,
o recibo correspondente e as pós-condições SQL precisam passar. `RAISE(IGNORE)`
injetado em versão, refs ou estado não pode retornar sucesso parcial. O
[RAISE(ABORT) do SQLite](https://www.sqlite.org/lang_createtrigger.html#the_raise_function)
é usado para invalidar o statement, não para mascarar erros.

Hash de idempotência: SHA-256 do envelope materializado/canônico completo (inclui
action, expectedRevision, operationId e documento). Chaves de objetos têm ordem
lexicográfica estável; ordem de arrays permanece significativa. Mesmo ID/ator/hash
retorna snapshot/revisão originais antes de testar revisão atual. Mesmo ID com
outro conteúdo ou ator conflita. Um novo ID é uma nova intenção, sujeito a CAS.
Operações concorrentes diferentes na mesma revisão têm exatamente um vencedor.
Replays concorrentes da mesma intenção produzem um único snapshot/recibo.

Refs incluem módulos ocultos. IDs inexistentes falham por FK; deleting/deleted
são recusados na transação. Mídia referenciada não pode ser apagada ou entrar em
exclusão; manifesto ready referenciado não pode ser substituído. Referência de
rascunho pode apontar para mídia existente em processamento/rejeitada, sem torná-la
publicável. Não há GC/retentiva operacional: versões e refs ficam preservadas.

## Provas, limites e próxima revisão

Testes D1 verificam linhas e conteúdo persistidos, incluindo revisões/snapshots,
catálogo completo antes/depois, refs e sessão. Cobrem primeira gravação, atualizações,
revisão obsoleta, concorrência, replay concorrente/pós-nova-revisão, sessão revogada,
usuário inativo, auth_version, expiração/origem alterada entre guard e escrita,
revogação dentro de trigger e rollback com falhas/IGNORE/refs extras.
O E2E usa Pages Functions reais, Chrome e D1 descartável: login real, resposta
perdida no browser, GET de recibo, replay, conflito, CSRF, leitura sem sessão e
catálogo público intacto. Não cria interface CMS.

Os dois asserts de rotas publish/media ausentes usam fetch real do Chrome com os
mesmos verbos/corpos e expectativa 404. APIRequestContext apresentou ECONNRESET
reproduzível nessa sequência no Pages local; controles no Chrome passaram 40/40.
Não houve mudança de fallback de produção, timeout, retry ou retirada de assert.
O diagnóstico limita a falha ao transporte local observado; não identifica a causa
interna completa e não comprova comportamento remoto. Ver relatório de validação.

Riscos residuais: sem quotas/latência/concorrência distribuída comprovadas no
provedor; sem processamento remoto de mídia; retenção ilimitada de versões precisa
de política posterior; validação de texto conservadora não substitui revisão
comercial ou escape do futuro renderer; auditoria Antigravity ainda necessária.
SQL guards protegem o caminho da aplicação, não constituem sandbox contra um
operador com acesso arbitrário ao banco. Alteração maliciosa de schema exige
controle operacional de credenciais e deploy, fora desta prova local.

Resultados exatos, inventário e veredito: [f4a1-validation.md](f4a1-validation.md).
Nenhum staging/commit/deploy autorizado nesta etapa; aguardar auditoria independente
e autorização explícita para eventual consolidação.

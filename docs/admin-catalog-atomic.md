# F3A.1 — snapshot e salvamento atômico

> Documento histórico F3A/F3A.1. Na F3A.2, as escritas v1 são aposentadas (410),
> as leituras legadas exigem projeção fiel e a fonte passa a ser o catálogo unificado.
> Contrato vigente e procedimento de corte: [catalog-expansion.md](catalog-expansion.md).


Base: F3A consolidada em `6e6e96d`; branch `feat/admin-catalog-atomic`.
Esta extensão permanece sem commit, aguardando revisão independente e aprovação.
Não integra a UI F3B nem modifica storefront, autenticação ou dados comerciais.

## Contrato HTTP e compatibilidade F3B

`GET /api/admin/catalog` e `PUT /api/admin/catalog` exigem autenticação F2.
PUT também exige CSRF conforme as regras existentes de Origin/Referer.
As respostas usam JSON, no-store e ausência de CORS aberto. Outros métodos
retornam 405 com `Allow: GET, PUT`; HEAD não tem corpo e OPTIONS não habilita CORS.

GET retorna diretamente `AdminCatalog`, sem envelope. Exemplo abreviado de formato
(um PUT deve incluir **todos** os registros existentes, inclusive ocultos):

```json
{
  "revision": "r0",
  "chopes": [
    {
      "id": "dronken",
      "name": "Dronken",
      "description": "Double Double",
      "visible": true,
      "prices": { "30": 51000, "50": 65000 }
    }
  ],
  "cachacas": [
    {
      "id": "cachaca",
      "name": "Temos cachaça",
      "description": "Conservada em barril de umburana com jequitibá rosa",
      "visible": true,
      "prices": { "bottle": 3000 }
    }
  ]
}
```

O header de resposta é `ETag: "r0"`. PUT recebe o mesmo objeto completo e
`If-Match: "r0"`. A revisão do corpo deve coincidir com a precondição; o cliente
trata ambos como tokens opacos, sem gerar ou incrementar revisões.
If-Match aceita uma única ETag forte canônica: `"r0"` ou `"rN"`, N inteiro decimal
seguro positivo sem zeros à esquerda. Recusa listas, wildcard e `W/`.

Os tipos de `catalog-contract.ts` correspondem estruturalmente aos tipos reais
de `AdminCatalogGateway` da F3B, commit `7fab0c5`, inspecionados sem modificar o
worktree do Claude. O adaptador futuro implementará:

```ts
load(signal?: AbortSignal): Promise<AdminCatalog>
save(next: AdminCatalog): Promise<AdminCatalog>
```

`load` faz GET com signal e `credentials: 'same-origin'`; `save` faz PUT com
`Content-Type: application/json`, `If-Match: JSON.stringify(next.revision)`,
`credentials: 'same-origin'` e `body: JSON.stringify(next)`. Usa a resposta como
novo snapshot. Não há conversão de preços ou campos no adaptador: `name` mapeia
o título da cachaça no servidor, e todos os preços administrativos são centavos.
`bottleMl` e singleton são preservados no banco e não integram o contrato F3B.

O tipo F3B admite slots opcionais; o snapshot real e o `buildCatalog` do editor
fornecem ambos os slots 30/50 e o slot bottle explicitamente. PUT exige essa forma
completa: omissão não equivale a null. A ordem do array chopes define a exibição.
Cachaças é uma lista de zero ou um item, respeitando o schema existente.
IDs são imutáveis e únicos inclusive entre grupos, como exige o mapa de edição
por ID da F3B. O seed atual satisfaz isso; futuros imports devem preservar a regra.

Mapeamento para `AdminApiError` da F3B:

| Resposta | code do adaptador | Ação |
|---|---|---|
| 401 | unauthenticated | Encerrar edição autenticada |
| 409 CATALOG_CONFLICT | conflict | Modal existente; bloquear salvar até descartar/recarregar |
| 400, 403, 428 | rejected | Mostrar recusa sem marcar como salvo |
| 503, falha de rede ou resposta inválida | unavailable | Preservar rascunho e oferecer recuperação |

Não substituir silenciosamente a revisão após 409. Se uma resposta 200 se perder,
reenviar o snapshot antigo resulta em 409 após alteração efetiva; recarregar revela
o estado persistido. Não há pedidos, cobranças ou outros efeitos financeiros.

| Status | Contrato |
|---|---|
| 200 | Snapshot completo e ETag atual; PUT idêntico preserva revisão |
| 400 VALIDATION_ERROR | `error.fields` identifica caminhos, como `chopes.0.prices.30`, `revision`, `ifMatch` ou `catalog` |
| 400 INVALID_REQUEST | JSON, UTF-8, mídia, tamanho ou prazo do corpo inválido |
| 401 UNAUTHENTICATED | Sessão ausente, revogada, expirada ou inválida na operação |
| 403 INVALID_ORIGIN | Proteção CSRF rejeitou a escrita |
| 409 CATALOG_CONFLICT | Revisão mudou; nenhuma escrita |
| 428 PRECONDITION_REQUIRED | Falta If-Match |
| 503 AUTH_UNAVAILABLE / ADMIN_CATALOG_UNAVAILABLE | Falha fechada, mensagem genérica |

PUT aceita somente revision/chopes/cachacas; cada item contém exatamente
id/name/description/visible/prices. Recusa IDs ausentes, extras, repetidos ou
transferidos de entidade. Não cria ou exclui registros. Limites: 128 itens no total,
131072 bytes UTF-8 efetivamente lidos e cinco segundos totais. Mantém a validação
Unicode e financeira da [F3A](admin-catalog-api.md): inteiros de 1 a 9999999 centavos,
null somente em barris não comercializados e produto visível com algum preço.
Erros não repetem conteúdo enviado nem expõem SQL, cookies ou segredos.

## Migration 0004 e operação transacional

Somente `0004_catalog_revision.sql` é nova. Migrations 0001/0002/0003 são imutáveis.
Não altera registros existentes, não executa seeds nem muda preços/visibilidade.

- `catalog_meta`: uma linha singleton, revision INTEGER entre 0 e MAX_SAFE_INTEGER.
- Seis triggers AFTER INSERT/UPDATE/DELETE em products/cachaca invalidam a revisão
  em alterações efetivas, inclusive pelos PATCHs existentes. UPDATE idêntico não
  avança. Falta de metadata ou overflow aborta a escrita comercial.
- `catalog_save`: view de comando, com payload NULL. Seu trigger INSTEAD OF UPDATE
  valida a bijeção de IDs, aplica reordenação/dados e verifica o estado final.
  Payload e prova não ficam persistidos; não existe save_guard compartilhado.

`createCatalogRepository` expõe apenas load/save com entradas tipadas. O comando
parametrizado inclui **no próprio WHERE** singleton, revisão esperada e
`adminWriteProof`: sessão, usuário ativo, auth_version, origem e expiração SQLite.
Os UPDATEs filhos executam no mesmo statement. Logout/revogação anterior bloqueia
toda a escrita; uma escrita já confirmada não é desfeita retroativamente.

Comando e leituras posteriores executam em uma única
[batch transacional D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
GET também usa somente SELECTs nessa batch para obter snapshot e prova consistentes.
Um erro SQL em qualquer etapa reverte a sequência inteira. A pós-condição SQL faz
RAISE(ABORT) se um trigger ignorar/alterar alguma gravação, evitando falso sucesso
parcial. Não depende de tratamento JavaScript para desfazer gravações confirmadas.

`RETURNING 1 AS accepted` é apenas o recibo da admissão do comando. A revisão e o
catálogo são lidos **depois** dos triggers: o
[RETURNING do SQLite](https://www.sqlite.org/lang_returning.html) não representa
o resultado de alterações posteriores de triggers. Não usamos changes() ou
meta.changes de uma view como prova de sucesso. Com zero recibos, a prova posterior
distingue 401 de 409; falta de metadata é 503. Erro de IDs é 400.

Cada linha efetivamente alterada pode avançar a revisão; um PUT pode avançá-la
várias vezes. Reordenação real normaliza sort_order para 0..n-1, convenção do seed.
Plano materializado evita recalcular a decisão enquanto as linhas mudam. Se a
sequência já coincide, preserva posições esparsas/empatadas de PATCH e o no-op.

## Evidências e execução local

```powershell
npm.cmd exec -- vitest run tests/backend/catalog-atomic.test.ts tests/backend/catalog-contract.test.ts tests/backend/catalog-transaction.test.ts tests/backend/catalog-migration.test.ts tests/backend/auth-migrations.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:backend
npm.cmd run build
npm.cmd audit
$env:PLAYWRIGHT_CHANNEL='chrome'
$env:PLAYWRIGHT_PORT='4174'
npm.cmd run test:e2e
git diff --check
```

Handlers usam D1 Miniflare descartável, migrations reais e sessões de login reais.
PoCs demonstram view INSTEAD OF, JSON, UPDATE FROM, CTE materializada, triggers
aninhados com recursive_triggers OFF e recibo RETURNING. Regressões cobrem:
concorrência de duas sessões (200/409), revogação entre guard/batch, falha na quinta
linha, erro na cachaça, escrita ignorada, erro em SELECT posterior, rollback de
dados/revisão/efeitos de trigger, retry de resposta perdida, no-op, reordenação,
PATCH invalidando revisão, INSERT/DELETE, metadata ausente, limites e contratos.
Migration testada sobre dados já editados; Wrangler --local reaplicado sem perder
edições nem resetar revisão. E2E usa Pages/Chrome reais para verificar as rotas e
falha fechada; escrita autenticada é comprovada pelos handlers com D1 descartável.

## Riscos remanescentes e limites

- **P2 operacional:** runtime e quotas remotas não foram testados nem autorizados.
  Esta migration está aprovada somente para experimentação local nesta tarefa.
- **P2 concorrência:** PATCHs individuais preservam sua semântica de última escrita;
  invalidam revisões do PUT, mas não exigem If-Match. O adaptador F3B deve salvar via PUT.
- **P2 recuperação:** restaurar banco/revision de backup pode reutilizar tokens antigos;
  o procedimento deve invalidar sessões/rascunhos anteriores antes de reabrir edição.
  O contador não é credencial, histórico ou trilha de auditoria.
- **P2 herdados F2:** ataques distribuídos, esgotamento de quotas e CPU de senha
  dependem de controles futuros de borda e observação operacional.
- Sem auditoria persistente ou integração do gateway real na F3B nesta fase.
  Nenhum componente F3B ou visual do storefront foi alterado.

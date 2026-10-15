# Catálogo expansível F3A.2 — implementação local

Branch `feat/catalog-expansion`, base `fbea7640f090aa46b34260bb135a750a58fa0f0a`.
Sem integração F3B, interface administrativa, exclusão persistente ou recursos remotos.

## Fonte de verdade e corte

`0005_catalog_expansion.sql` é a única migration nova. Não há espelho nem 0006.
Ela copia **os registros efetivos** de `products`/`cachaca`, incluindo edições locais;
não importa o seed. `catalog_meta` permanece a mesma tabela e o corte avança sua
revisão uma vez. Comparações SQL `EXCEPT` nas duas direções verificam todos os
campos copiados; divergência ou FK inválida aborta. IDs conflitantes entre entidades,
preços/ordens/textos incompatíveis com as restrições novas abortam, sem corrigir dados.

| Tabela | Contrato |
|---|---|
| `catalog_categories` | id string PK, nome, ordem inteira; inicialmente chopes/cachacas |
| `catalog_items` | id string global PK, categoria FK, nome, descrição, visibilidade, ordem, creation_ref nullable UNIQUE |
| `catalog_variants` | PK(item_id, code), item FK, rótulo, volume_ml, price_cents, ordem, creation_ref nullable UNIQUE global |
| `catalog_meta` | Singleton existente, revisão inteira segura; o cliente a trata como token opaco |

Preços são inteiros de 1 a 9999999 centavos; null indica apresentação não comercializada.
Volumes de chopes/cachaças são inteiros positivos seguros. Categorias futuras podem
representar unidades sem volume (null). Cada item tem ao menos uma variante; item
visível exige uma variante com preço. Todas as variantes de cachaça exigem preço,
mesmo com o item oculto. Os códigos históricos 30/50 mantêm seus volumes.

Triggers bloqueiam INSERT/UPDATE/DELETE nas duas tabelas antigas com
`CATALOG_LEGACY_READ_ONLY`. As tabelas ficam congeladas para conferência/recuperação.
O comando `catalog_save` da 0004 é removido. Não há fallback de leitura para arquivos
antigos. As fixtures dos testes históricos continuam validando 0001–0004; as rotas
Pages de produção usam exclusivamente os adaptadores novos.

## Contratos HTTP

`GET /api/admin/catalog/v2` exige a sessão administrativa F2 e retorna ETag forte,
`Cache-Control: no-store`, todos os itens (inclusive ocultos) e seus metadados:

```json
{
  "revision": "r42",
  "categories": [{"id":"chopes","name":"Chopes","items":[{
    "id":"dronken","creationRef":null,"name":"Dronken","description":"Double Double",
    "visible":true,"variants":[{
      "code":"30","creationRef":null,"label":"Barril de 30 L",
      "volumeMl":30000,"priceCents":51029
    }]
  }]}]
}
```

O exemplo é abreviado: o GET real inclui **todas** as categorias, itens e variantes.
`PUT /api/admin/catalog/v2` exige mesma origem/CSRF F2, sessão e `If-Match: "r42"`.
O corpo tem `revision` igual ao token do header e o snapshot completo. Ordem de arrays
determina a ordenação; posições esparsas/empatadas são preservadas se a sequência não mudar.
`creationRef` é somente leitura e deve ser removido do DTO de escrita.

Um item persistido usa `id`; um novo usa `clientId: "tmp:<UUID minúsculo>"` em vez de id.
Uma variante persistida usa `code`; uma nova usa `clientId` em vez de code.
Campos restantes são obrigatórios: item `{name,description,visible,variants}` e
variante `{label,volumeMl,priceCents}`. Não envie campos desconhecidos.
Categorias usam `{id,name,items}`: seus conjuntos/nomes não são editáveis; categoria
de item persistido também não muda. Pode ordenar categorias predefinidas.

Nenhum item/variante persistente pode desaparecer por omissão, mesmo oculto ou null.
IDs/códigos desconhecidos, repetidos, trocados de entidade ou pai são inválidos.
O servidor gera `item_<UUID>`/`v_<UUID>` e persiste o clientId original como creationRef.
As refs são únicas também entre variantes de pais distintos; o comando rejeita
reutilização cruzada entre itens/variantes.

Sucesso 200:

```json
{"catalog":{"revision":"r47","categories":[]},"created":{
  "items":[{"clientId":"tmp:<UUID>","id":"item_<UUID>"}],
  "variants":[{"itemId":"item_<UUID>","clientId":"tmp:<UUID>","code":"v_<UUID>"}]
}}
```

O catálogo do exemplo foi abreviado. No-op mantém revisão; uma gravação pode avançá-la
várias unidades. Nunca calcule a próxima revisão no cliente.

| HTTP | Significado |
|---|---|
| 400 | JSON, UTF-8, identidade, campos, valores ou referência inválidos; campos legíveis em VALIDATION_ERROR |
| 401 / 403 | Sessão inválida/revogada ou CSRF/origem rejeitada |
| 405 | Método não contratado, Allow explícito; HEAD sem corpo, sem suporte artificial a OPTIONS |
| 409 | CATALOG_CONFLICT: releia e reconcilie, sem sobrescrever automaticamente |
| 428 | If-Match ausente |
| 503 | Infraestrutura/schema/snapshot indisponível; nenhuma mensagem SQL é exposta |

### Atomicidade e autorização

O repositório encapsula uma batch: comando UPDATE da view `catalog_write` + quatro
leituras do snapshot. O UPDATE condiciona admissão à revisão, schema completo e
`adminWriteProof` parametrizada. Todas as mutações ocorrem no trigger desse **único
statement**; zero linhas admitidas não executam nenhuma delas. Não existe SELECT
de autorização seguido de UPDATE desprotegido. Ao final, a prova de sessão/usuário
ativo/auth_version/origem/expiração é conferida novamente dentro do comando.

Conjuntos completos de identidades são conferidos antes da escrita. Pós-condições
conferem dados, refs, ordem e invariantes; RAISE(IGNORE) não vira sucesso. Os triggers
de revisão exigem `changes() = 1` ao atualizar o singleton, para que ignorar o avanço
da revisão também aborte. Erro em qualquer statement posterior da batch reverte o
comando. RETURNING é recibo de admissão; a revisão é lida depois dos triggers.
Uma assinatura JSON canônica do estado anterior, capturada em OLD pela view, permite
exigir avanço de revisão se o estado final diferir. Isso também detecta um AFTER IGNORE
que impeça a execução do próprio trigger de revisão. Schema/singleton são conferidos
novamente ao final; resultados NULL não podem autorizar commit sem metadados.

### Resposta perdida

Repetir a intenção com sua revisão antiga devolve 409, sem segunda criação.
GET retorna as refs e permite recuperar os IDs gerados. Isso **depende de o cliente
preservar os clientIds originais**, a revisão base e o rascunho até reconciliar.
Não atualizar a revisão e reenviar uma criação incerta nem regenerar refs no retry.
Mesmo um retry com revisão atual e ref já persistida é rejeitado. O journal de aba
e seu formulário ficam para a integração F3B, que ainda não foi autorizada.

## Leitura pública e compatibilidade

`GET /api/catalog` usa o mesmo snapshot transacional e os mesmos centavos. Retorna
todas as categorias e todos os itens visíveis, incluindo **todas** suas variantes,
preços null e volumes. Remove creationRef. Não trunca por limites de escrita,
allowlist de categorias ou primeiro registro. Estado inválido falha inteiro com 503.

O storefront consulta essa rota, converte centavos na fronteira e renderiza múltiplas
cachaças e variantes/categorias adicionais. Para os dados atuais mantém tabela,
textos, classes e banner; formatos adicionais usam listas sem alterar CSS.
Loading, erro e retry continuam sem seed estático.

GETs antigos (`/api/products`, `/api/admin/products`, `/api/admin/cachacas`,
`/api/admin/catalog`) projetam a fonte nova apenas se forem integralmente
representáveis: ordem chopes/cachacas, variantes 30/50 nesta ordem e rótulos/volumes
originais, no máximo uma cachaça com a variante bottle. Caso contrário retornam
409 `CATALOG_REQUIRES_NEW_CLIENT`, sem omitir variantes extras, mesmo null.
Na API pública só itens visíveis participam dessa verificação.

PATCHs antigos de produtos/cachaças e PUT `/api/admin/catalog` retornam
410 `ENDPOINT_RETIRED` **após autenticação e CSRF**. Não existe ponte de escrita v1.

## Procedimento local e recuperação

Antes de aplicar 0005, execute o [preflight somente leitura](catalog-preflight.md)
sobre uma cópia local consistente da origem 0004. Ele reutiliza as regras v2 e
diagnostica dados invisíveis/incompatíveis sem corrigi-los. Um resultado positivo
não substitui a janela sem escritores, o backup nem as asserções SQL da migration.

1. Parar Pages/Vite proxies e todos os escritores/bootstraps que usem o estado alvo.
2. Com o runtime parado, fazer cópia consistente do diretório de estado D1 local,
   incluindo arquivos auxiliares. Conferir catálogo, conta, revisão e histórico da cópia.
3. Inspecionar dados efetivos e compatibilidade com as restrições acima. Não rodar seed.
4. Aplicar apenas localmente, no diretório de estado escolhido:
   `npm.cmd run db:init -- --persist-to <diretório-local>`.
5. Conferir `PRAGMA foreign_key_check`, equivalência/origens congeladas, histórico
   0005 e `SELECT * FROM catalog_ready`; exercitar GET público e GET admin.
6. Só reabrir escritores novos após schema válido e consumidores prontos.

Wrangler e Miniflare devem usar o mesmo diretório **e identificador local**.
Uma falha no arquivo 0005 testada pelo Wrangler reverte DDL, dados e histórico.
Se houver DDL parcial feito fora desse fluxo, não considerar schema parcial válido:
`catalog_ready` exige histórico, singleton, tabelas, views e índices previstos,
triggers de revisão/congelamento/comando e ausência do comando antigo; consultas
também falham se colunas faltarem. Remover a view de pós-condição fecha inclusive GET.
Não inserir o histórico manualmente para encobrir falha e não usar IF NOT EXISTS.
Com escritores parados, restaurar a cópia verificada em outro estado local e repetir
o corte correto. Se 0005 já constar como aplicada, investigar e criar correção adiante;
não editar arquivo aplicado nem apagar histórico para forçar reaplicação.
Antes de reabrir uma restauração, invalidar sessões e descartar rascunhos/revisões
anteriores: restaurar o contador pode reutilizar um token que um cliente antigo guardou.

Depois de criações novas não há rollback comercial sem perda para o modelo antigo.
Recuperar com backup verificado/avanço controlado; não escolher silenciosamente uma
das cachaças nem descartar variantes. Ainda não há procedimento autorizado remoto.

## Testes e limites

```powershell
npm.cmd test -- --maxWorkers=1
npm.cmd run test:backend -- --maxWorkers=1
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd run test:e2e
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit
git diff --check
```

As suites pesadas são executadas separadamente. Os testes novos usam D1 descartável;
os de Wrangler copiam migrations para diretório temporário próprio e validam rollback
em quatro checkpoints mais divergência de equivalência. O teste de reaplicação usa
o arquivo definitivo. Nenhuma migration remota é executada.

Orçamento de escrita local: 128 KiB UTF-8, 128 itens, até 8 variantes/item e 512 totais.
O teste real cria 128 itens/512 variantes, mede SQL e repete no-op; testa corpo no
teto e rejeita o byte excedente. Limites são cumulativos: descrições longas podem
esgotar bytes antes do número de itens. GET nunca aplica esses limites.
Métricas locais e resultados finais são registrados em `tasks/todo.md`; não são SLA
nem prova de quotas, CPU de Worker ou latência Cloudflare. Banco/conta remotos,
planos gratuitos/pagos, concorrência distribuída e proteção na borda permanecem
fora desta validação. Uma criação que excedesse limites exigiria novo orçamento
e revisão; não elevar tetos silenciosamente.

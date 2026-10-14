# F3A — APIs administrativas do catálogo

Base: F2/F2.1 consolidada no commit local `a5a4563`. Branch `feat/admin-catalog-api`.
Esta fase cria somente leitura e edição administrativa dos registros existentes.
Nenhuma migration, seed, dependência, binding ou interface gráfica foi adicionada.

## Schema e escopo

O schema real do D1 local foi inspecionado via `sqlite_master`, com Wrangler `--local`.
`products` contém id, name, description, price_30_cents, price_50_cents, visible e
sort_order. `cachaca` contém id, title, description, bottle_ml, price_cents, visible e
singleton. A restrição singleton permite zero ou uma cachaça: o endpoint retorna
uma coleção para consultar todos os registros existentes, inclusive ocultos,
preservando esse limite. Não há campo de ordenação para essa entidade única.
`bottleMl`, IDs e singleton não são editáveis; ordenação aplica-se aos chopes.
Não há criação, exclusão ou paginação: o catálogo atual tem oito chopes e uma
cachaça, e esta fase não permite ampliar sua cardinalidade.

## Rotas e contratos JSON

Todas as rotas usam a origem configurada para autenticação, cookie F2 e
`Cache-Control: no-store`, sem CORS aberto. Métodos não listados são 405 com Allow;
HEAD retorna corpo vazio e OPTIONS não habilita acesso entre origens.

| Rota | Entrada / saída |
|---|---|
| `GET /api/admin/products` | `{ "products": [AdminProduct] }`, inclusive ocultos; ordem sort_order e id |
| `GET /api/admin/cachacas` | `{ "cachacas": [AdminCachaca] }`, inclusive oculta; ordem id |
| `PATCH /api/admin/products/:id` | Objeto parcial; retorna `{ "product": AdminProduct, "changed": boolean }` |
| `PATCH /api/admin/cachacas/:id` | Objeto parcial; retorna `{ "cachaca": AdminCachaca, "changed": boolean }` |

```json
{
  "id": "dronken",
  "name": "Dronken",
  "description": "Double Double",
  "pricesCents": { "30": 51000, "50": 65000 },
  "visible": true,
  "sortOrder": 0
}
```

```json
{
  "id": "cachaca",
  "title": "Temos cachaça",
  "description": "Conservada em barril de umburana com jequitibá rosa",
  "bottleMl": 700,
  "priceCents": 3000,
  "visible": true
}
```

PATCH de produto permite somente `name`, `description`, `pricesCents`, `visible`
e `sortOrder`. PATCH de cachaça permite somente `title`, `description`, `priceCents`
e `visible`. Campos omitidos permanecem intactos. `pricesCents` aceita atualização
parcial: `{ "pricesCents": { "30": null } }` preserva o preço de 50 L.
`null` significa tamanho não comercializado; não controla visibilidade ou estoque.
Preços presentes devem estar entre 1 e 9999999 centavos, conforme F3B; zero é
recusado na API mesmo que o schema antigo o permita. Produto visível deve ter ao
menos um preço válido. Oculto pode manter os dois tamanhos null. A validação do
estado final ocorre no próprio UPDATE, protegendo também PATCHs parciais concorrentes.
O preço da cachaça não aceita null. Nenhum dado ou migration antiga foi alterado.

Os preços administrativos são centavos inteiros de 1 a 9999999 e seguros em JS.
Também precisam passar pelo roundtrip `centsToReais`: valores cujo número público
perderia precisão são recusados. Strings, frações de centavo, negativos, NaN,
Infinity e overflow não são aceitos. A API pública continua convertendo centavos
para reais com o contrato existente; 49099 e 29 tornam-se 490.99 e 0.29.
Um cliente deve tratar campos Cents como centavos; não enviar reais nesse campo.

JSON deve ser um objeto não vazio sem campos extras; `pricesCents` deve conter
ao menos um tamanho 30/50 e nenhum outro. Nome/título: texto não vazio após trim,
até 120 pontos de código, sem controles ASCII. Descrição: até 2000 pontos de
código, podendo ser vazia ou conter tabulação/quebras de linha. Textos recusam
surrogates soltos e Bidi_Control; nomes/títulos precisam de caractere visível após
ignorar marcas combinantes, espaços, Default_Ignorable_Code_Point e Braille Blank.
Emoji/ZWJ junto de caracteres visíveis continuam aceitos. Nenhum texto é
convertido para HTML. `visible` exige boolean; `sortOrder` exige inteiro entre
0 e 2147483647. IDs de rota exigem string de 1–128 unidades UTF-16 sem controles.
O corpo exige application/json, UTF-8 válido, no máximo 16384 bytes reais e prazo
total de cinco segundos. Content-Length não substitui a medição efetiva.

| Status | Significado |
|---|---|
| 200, changed:true | UPDATE autorizado e realizado |
| 200, changed:false | Registro existente, sessão vigente e todos os campos enviados já iguais; nenhum UPDATE efetivo |
| 400 INVALID_REQUEST | JSON/UTF-8/tipo de mídia/corpo inválido, grande ou lento |
| 400 VALIDATION_ERROR | Campos inválidos; `error.fields` identifica campo e regra sem repetir valores enviados |
| 401 UNAUTHENTICATED | Cookie/sessão inválidos ou revogação/expiração entre guard e operação |
| 403 INVALID_ORIGIN | Falha CSRF na escrita |
| 404 NOT_FOUND | Registro ausente, com autorização ainda válida |
| 405 METHOD_NOT_ALLOWED | Método não permitido |
| 503 AUTH_UNAVAILABLE / ADMIN_CATALOG_UNAVAILABLE | Configuração/autenticação ou D1 indisponíveis; nenhuma falha abre acesso |

Erros seguem `{ "error": { "code": "...", "message": "...", "fields": {} } }`,
com fields somente em validação. Não incluem SQL, cookies, tokens, hashes, pepper,
valores comerciais enviados ou detalhes internos. Logs da F3A usam somente
`ADMIN_CATALOG_UNAVAILABLE`; erros do guard mantêm o código fixo aprovado na F2.

## Autorização e operações SQL

Os quatro entrypoints Pages chamam handlers com recurso constante e id vindo dos
parâmetros da rota. Cada handler chama `requireAdmin`. PATCH exige Origin válido,
com o fallback de Referer e as demais regras CSRF aprovadas na F2.

`createAdminCatalogRepository(db, authorization)` recebe principal/config do guard
e encapsula a prova. Exporta somente listProducts/listCachacas/updateProduct/
updateCachaca, com patches tipados; não recebe SQL, tabela ou coluna arbitrários.
Colunas de SET vêm de uma lista interna tipada e todo valor usa bind.

GET executa apenas SELECTs, incluindo a prova de sessão na mesma transação das
leituras. Assim, revogação entre o guard e a batch devolve 401 sem divulgar dados.
PATCH executa uma [batch transacional D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch):

1. UPDATE com `id = ? AND adminWriteProof.sql` no próprio WHERE e comparação
   `column IS NOT ?` para ignorar operações idênticas. `RETURNING` confirma a escrita.
2. SELECT da prova para diagnosticar zero linhas, na mesma transação.
3. SELECT do registro para distinguir ausência de operação idêntica.

O SELECT diagnóstico ocorre **depois** do UPDATE protegido; nunca substitui a prova
no UPDATE. A prova reavalia token hash, usuário ativo, auth_version, origem e prazo
de sessão com o relógio SQLite. Se zero linhas forem alteradas, recusa de sessão
tem prioridade sobre 404/no-op. Se a sessão for válida e o registro existir, os
valores persistidos devem coincidir com o patch para responder changed:false;
uma mutação ignorada pelo banco não vira falso sucesso. Falhas SQL na batch
revertem sua sequência inteira. Não se promete desfazer uma escrita que já foi
confirmada pelo banco caso a resposta HTTP se perca.

Uma escrita confirmada antes de logout/revogação pode retornar 200. Revogação
primeiro impede a escrita. Nenhuma aplicação pode desfazer retroativamente uma
operação já autorizada. Os testes forçam a revogação antes do SQL e também
executam requests de PATCH/logout realmente em paralelo.

## Executar e verificar localmente

Use os comandos locais de bootstrap/desenvolvimento em [admin-auth.md](admin-auth.md).
Não precisa reaplicar seeds ou rebuild após uma edição; uma nova leitura pública
consulta os dados persistidos. Nenhuma conta real foi criada nesta fase.

```powershell
npm.cmd exec -- vitest run tests/backend/admin-catalog.test.ts tests/backend/admin-catalog-validation.test.ts
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

Integração usa Miniflare/D1 descartável com as três migrations existentes.
As fixtures fazem login real com credenciais sintéticas, sem mocks de autorização
ou de execução SQL. Proxies de teste somente observam bind/SQL ou controlam o
momento de uma revogação/falha, executando operações reais no D1. E2E verifica o
roteamento Pages, métodos, falha fechada sem sessão e catálogo público intacto;
os testes D1 cobrem escrita autenticada, dinheiro, no-op, revogação e rollback.

## Riscos e decisões para a próxima fase

- **P2:** edições simultâneas do mesmo campo seguem a última escrita autorizada.
  Campos omitidos não são sobrescritos. Antes de múltiplos editores, considerar
  revisão/ETag ou controle de concorrência, com necessidade de schema demonstrada.
- **P2:** permanecem riscos de ataque distribuído, quotas compartilhadas e orçamento
  CPU da F2.1. Não foram criados recursos de borda, remoto ou de proteção adicional.
- **P2:** não há histórico/auditoria persistente de alterações. Antes de publicar um
  painel, decidir trilha e procedimento de recuperação. F3A não adiciona tabelas por antecipação.
- **P2:** o runtime/quotas de produção continuam sem validação remota autorizada.
  Os gates locais não demonstram disponibilidade sob ataques reais.
- O futuro painel deve renderizar nomes/descrições como texto, converter entradas
  monetárias com precisão e tratar 401/403/503 e changed:false explicitamente.
  O repositório reduz risco de omitir a prova; futuras mutações devem usá-lo ou
  manter a mesma autorização no SQL, com regressões próprias.

O storefront, migrations, seed e autenticação aprovados permanecem intactos.
Não foi feito commit da F3A, publicação ou operação remota. A entrega aguarda revisão
independente e aprovação antes da próxima etapa.

# Chopp Delivery Delegas

## Backend F1: catálogo público

React/Vite consulta `GET /api/products` na mesma origem. A Pages Function lê o binding
`DELEGAS_DB` do Cloudflare D1. Não há fallback para catálogo estático, estoque, pedidos,
reservas, login ou painel nesta etapa. Os dados de `src/features/catalog/products.ts`
são apenas uma fixture histórica dos testes; não são importados pela interface.

### Desenvolvimento local no Windows

Requer Node.js e dependências instaladas com `npm ci`. Não execute `playwright install`
para os testes locais: eles usam o Google Chrome já instalado.

```powershell
npm.cmd run dev:full
```

Esse comando aplica apenas migrations locais, faz o build e inicia Pages Functions
com D1 persistido em `.wrangler/state`. Abra `http://127.0.0.1:8788`.

Para trabalhar no frontend com HMR, mantenha o backend acima aberto e execute
`npm.cmd run dev` em outro terminal. Use a URL informada pelo Vite; `/api` é encaminhada
para `http://127.0.0.1:8788`. Para refletir alterações de frontend na URL do Pages,
execute o build novamente. Alterações de dados no D1 não exigem rebuild.

`npm.cmd run db:init` pode ser repetido: o controle de migrations não reaplica seeds
já executados. Mesmo uma reexecução isolada do seed usa `ON CONFLICT(id) DO NOTHING`,
sem atualizar preços, textos ou visibilidade existentes. Não rode seeds no handler.
Migrations aplicadas devem permanecer imutáveis; mudanças futuras ganham novos arquivos.

O arquivo `wrangler.jsonc` contém um identificador deliberadamente local (`delegas-local-only`),
sem UUID de banco remoto, e `preview_database_id` exclusivo do binding Delegas.
Nenhum recurso Cloudflare foi criado. Não use `--remote`, nem publique esta configuração.
A data `2026-08-06` corresponde à data mais recente suportada pelo workerd instalado.

### Schema e contrato

`products`: `id` TEXT estável, `name`, `description`, `price_30_cents` e
`price_50_cents` INTEGER nullable, `visible` 0/1 e `sort_order` INTEGER.
`cachaca`: entidade única com `id` TEXT, `title`, `description`, `bottle_ml`,
`price_cents` INTEGER e `visible` 0/1. Tabelas STRICT e CHECKs impedem centavos
fracionários, negativos e fora do limite inteiro seguro. Não há coluna de estoque.

As duas leituras SELECT são parametrizadas (`visible = ?`, bind 1) e executadas
em batch D1. Chopes são ordenados por `sort_order, id`. Produtos ocultos não são
retornados, mesmo quando têm preços; produtos visíveis com ambos os preços null
continuam visíveis. Cachaça oculta ou ausente retorna `null`.

Resposta 200 (`Content-Type: application/json`, `Cache-Control: no-store`):

```json
{
  "products": [
    {
      "id": "dronken",
      "name": "Dronken",
      "description": "Double Double",
      "prices": { "30": 510, "50": 650 },
      "visible": true
    }
  ],
  "cachaca": {
    "id": "cachaca",
    "title": "Temos cachaça",
    "description": "Conservada em barril de umburana com jequitibá rosa",
    "bottleMl": 700,
    "price": 30
  }
}
```

A resposta usa reais para preservar os contratos existentes. Internamente, 510 reais
são 51000 centavos. `shared/money.ts` valida conversões por representação decimal,
sem arredondar multiplicações de ponto flutuante: 0.29 → 29, 490.99 → 49099;
1.005 é rejeitado. Valores que perderiam precisão na conversão de volta também
são rejeitados. A validação do cliente rejeita contratos inválidos, IDs duplicados,
produtos ocultos e preços com mais de duas casas. Preços fracionários são exibidos
com centavos; os valores inteiros atuais mantêm sua apresentação.

Falhas de banco/conversão retornam 503 com
`{"error":{"code":"CATALOG_UNAVAILABLE","message":"Catálogo indisponível no momento."}}`.
Detalhes ficam no log do servidor. Métodos diferentes de GET retornam 405 e `Allow: GET`.
Nenhuma consulta pública grava dados. A interface mostra carregamento, erro com
tentativa manual e estado vazio; leitura limitada a 10 segundos e cancelada no unmount.

### Testes e qualidade

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:backend
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:PLAYWRIGHT_PORT = '4174'
npm.cmd run test:e2e
git diff --check
```

E2E inicia Pages Functions e D1 próprios em `.wrangler/e2e-state`, com migrations
nessa mesma pasta, sem reutilizar servidores existentes. Use uma porta livre.
Sem `PLAYWRIGHT_CHANNEL`, permanece o Chromium padrão para CI. `CHROMIUM_PATH`
continua disponível como override do executável e deve estar ausente ao selecionar
Chrome pelo canal.

Os 26 E2E originais aguardam o catálogo antes das medições. Cinco testes novos
verificam a API real, carregamento, falha/recuperação, catálogo vazio e atualização
de preços decimais por nova leitura. Testes Vitest dos handlers usam Miniflare,
com D1 não persistente e novo banco por teste; todos são descartados ao encerrar.

Para regenerar o binding: `npm.cmd run types:backend`. O arquivo gerado
`worker-configuration.d.ts` é validado por TypeScript e `wrangler types --check`,
e excluído do Biome para preservar a saída oficial do gerador.

### Pendências da F1

Ainda não existe D1 remoto ou publicação. Antes disso, criar banco exclusivo do
Delegas, revisar a configuração de ambientes e aplicar migrations mediante autorização.
A próxima fase pode acrescentar autenticação e edição administrativa com validação
monetária, aproveitando esta fundação, sem misturar visibilidade com estoque.

O audit de 2026-10-14 sinalizou avisos high em dependências de desenvolvimento do
Miniflare (`sharp` e `undici`). Não são dependências do bundle público nem do handler
publicado; esta F1 não processa imagens ou URLs externas. O servidor local escuta
somente em loopback. Revisar versões oficiais corrigidas antes da publicação;
não foi aplicado `npm audit fix --force` ou override não validado.

Referências: [Pages/D1 local](https://developers.cloudflare.com/d1/best-practices/local-development/),
[testes D1 com Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/),
[configuração Pages](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

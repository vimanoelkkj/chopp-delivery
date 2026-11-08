# Renomear a cachaça em produção: `Temos cachaça` → `Cachaça Artesanal`

**Estado: preparado. Nenhum comando de escrita foi executado. Executar exige autorização explícita do responsável.** Somente o nome muda: ID, variante, volume (700 ml), preço (R$ 30,00), visibilidade e disponibilidade permanecem.

## Onde o nome vive (verificado no código)

| Camada | Local | Ação |
|---|---|---|
| **Fonte da verdade em produção** | `catalog_items.name` onde `id = 'cachaca'` | **Esta operação** |
| API pública `/api/products` | `server/catalog-expansion/legacy.ts` projeta `catalog_items.name` → `cachaca.title` | Muda sozinha |
| API v2 `/api/catalog` | lê `catalog_items.name` | Muda sozinha |
| Tabela legada `cachaca` | congelada pela migration `0005` (`CATALOG_LEGACY_READ_ONLY`) | **Não tocar** (o `UPDATE` abortaria) |
| Seed `migrations/0002_catalog_seed.sql` | histórico aplicado | **Não editar** |
| Fixture `src/features/catalog/products.ts` | espelho histórico do seed, usado só por testes (`tests/backend/products.test.ts` exige igualdade com o D1 semeado); **não é fallback de runtime** | **Não alterar** |
| Fallbacks de runtime | nenhum: o frontend sempre exibe o título vindo da API | Nada a mudar no código |
| Mensagem de pedido | usa o nome vindo da API (`cachacaProductName`) | Segue o nome novo |

## Impacto (verificado)

- **IDs e referências:** chave primária é `catalog_items.id = 'cachaca'`; `catalog_variants.item_id` aponta para o ID, não para o nome. Nada no código resolve a cachaça pelo nome. Não há tabela de pedidos (o pedido nasce e termina no WhatsApp), logo não há pedido existente a corrigir.
- **Revisão do catálogo:** o trigger `catalog_items_revision_update` incrementa `catalog_meta.revision` em 1. Uma tela do painel admin aberta antes da troca receberá `409` ao salvar e precisa recarregar. Fazer fora de edição ativa.
- **Mensagem WhatsApp:** `cachacaProductName` só remove o prefixo "Temos "; `Cachaça Artesanal` passa intacto: *"…adicionar a Cachaça Artesanal (Garrafa - 700ml) ao meu pedido. Quantidade: 1 unidade. Preço unitário: R$ 30,00. Total: R$ 30,00."*
- **E2E local:** `e2e/catalog-expansion.spec.ts` e `catalog-api.spec.ts` usam o D1 local semeado pela `0002` (`Temos cachaça`) e continuam válidos; o seed não é alterado.

## Procedimento (PowerShell, raiz do repositório)

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'
$cfg = 'wrangler.production.jsonc'
$db  = 'chopp-delivery-prod-db'   # UUID fe4492e3-94a4-4f9a-b44c-10a39fe21bd1
```

Sempre `--config wrangler.production.jsonc`; conferir "Resource location: remote" e o UUID acima antes de qualquer `y`.

### 1. Antes (somente leitura) e ponto de retorno

```powershell
npx wrangler d1 info $db --json                       # uuid e name esperados
npx wrangler d1 time-travel info $db --config $cfg    # ANOTAR o bookmark (retorno)
npx wrangler d1 export $db --remote --config $cfg --output $env:USERPROFILE\chopp-prod-backups\prod-antes-rename.sql
npx wrangler d1 execute $db --remote --config $cfg --json --command "SELECT i.id, i.name, i.visible, v.code, v.volume_ml, v.price_cents, (SELECT revision FROM catalog_meta) AS revision FROM catalog_items i JOIN catalog_variants v ON v.item_id = i.id WHERE i.id = 'cachaca'"
```

Esperado: `name = 'Temos cachaça'`, `visible = 1`, `code = 'bottle'`, `volume_ml = 700`, `price_cents = 3000`. Anotar `revision` (R). Qualquer divergência é **NO-GO**. Pasta de backup fora do repositório.

### 2. Escrita (única, guardada)

```powershell
npx wrangler d1 execute $db --remote --config $cfg --json --command "UPDATE catalog_items SET name = 'Cachaça Artesanal' WHERE id = 'cachaca' AND name = 'Temos cachaça'"
```

A cláusula `AND name = 'Temos cachaça'` torna o comando idempotente e seguro: se o nome já mudou, afeta 0 linhas. Esperado: `changes` = 1 (mais a escrita do trigger em `catalog_meta`).

### 3. Depois (somente leitura)

Repetir a consulta do passo 1. Esperado: `name = 'Cachaça Artesanal'`; `visible`, `code`, `volume_ml = 700` e `price_cents = 3000` **idênticos**; `revision = R + 1`. Conferir também que o restante não mudou:

```powershell
npx wrangler d1 execute $db --remote --config $cfg --json --command "SELECT (SELECT count(*) FROM catalog_items) AS itens, (SELECT count(*) FROM catalog_variants) AS variantes, (SELECT count(*) FROM catalog_items WHERE visible = 1) AS visiveis, (SELECT count(*) FROM catalog_variants WHERE price_cents IS NULL) AS sem_preco, (SELECT sum(price_cents) FROM catalog_variants) AS soma_precos"
```

Esperado: `9, 17, 9, 3` e `soma_precos` igual à do passo 1 (rodar a mesma consulta antes e comparar). Com sessão Access válida, conferir `/api/products` → `cachaca.title = "Cachaça Artesanal"`.

### Recuperação

- **Reversão pontual** (mesma guarda, outro sentido):
  ```powershell
  npx wrangler d1 execute $db --remote --config $cfg --json --command "UPDATE catalog_items SET name = 'Temos cachaça' WHERE id = 'cachaca' AND name = 'Cachaça Artesanal'"
  ```
  A revisão sobe de novo (R + 2); isso é esperado.
- **Restauração completa:** `npx wrangler d1 time-travel restore $db --config $cfg --bookmark <bookmark anotado>` (afeta todo o banco; só se a reversão pontual não bastar) ou reimportação do `prod-antes-rename.sql`.

## Ordem no release

1. O rename é puramente de dados e independe do deploy do frontend: pode ser feito antes ou depois dele.
2. Executar este procedimento.
3. Verificar `/api/products` autenticado. Até o passo 2 a vitrine mostra `Temos cachaça`, sem quebra funcional.

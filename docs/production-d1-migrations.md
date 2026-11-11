# Migrations D1 de produção (H10.8)

> **Atualização:** este documento descreve a aplicação inicial (`0001`–`0012`, já feita em produção). Pendentes para o próximo release: `0013_catalog_item_media.sql` e `0014_catalog_write_trigger_lighter_ordering.sql`, nesta ordem, antes do deploy do Pages. O procedimento (backup, bookmark, `migrations apply` com `--config wrangler.production.jsonc`, verificação e rollback) está em [production-release-runbook.md](production-release-runbook.md). A `0014` corrige o erro `SQLITE_ERROR 7500` do `PUT /api/admin/catalog/v2` no D1 remoto.

**Estado: preparado e validado em D1 local descartável. Nenhuma migration remota foi aplicada. Aplicar exige autorização explícita do responsável.** Wrangler 4.151.0; PowerShell na raiz do repositório.

## Alvo

| | |
|---|---|
| Banco | `chopp-delivery-prod-db` |
| UUID | `fe4492e3-94a4-4f9a-b44c-10a39fe21bd1` |
| Conta | `7d8a62a0e64b693184975560c7cb788d` |
| Configuração | [wrangler.production.jsonc](../wrangler.production.jsonc) (binding `DELEGAS_DB`; sem R2, serviços ou UUID de homologação) |
| Homologação (**nunca** o alvo) | `chopp-delivery-homolog-db` / `e5941166-fc42-478b-b007-2c9f44e260b6` |

Use sempre `--config wrangler.production.jsonc`. O `wrangler.jsonc` da raiz também define `DELEGAS_DB` (banco local de laboratório) e o da homologação aponta para o D1 de homologação: um comando sem `--config` explícito pode mirar o banco errado.

## Migrations

`migrations/0001_catalog.sql` … `0012_cms_publication.sql`: 12 arquivos, numeração contígua, mesma lista registrada em `d1_migrations` da homologação (comparada em leitura). O `wrangler d1 migrations apply` registra cada arquivo pelo **nome exato** (`0012_cms_publication.sql`) em `d1_migrations`. As migrations `0005`, `0006`, `0009` e `0012` consultam `d1_migrations` pelo nome; por isso a aplicação tem de ser a oficial, nunca SQL manual (a view `cms_ready_publication` só fica "pronta" depois que o Wrangler registra `0011` e `0012`). Efeito da `0012`: remove os triggers de instalação e deixa a publicação CMS pronta, sem conteúdo editorial.

Resultado esperado em banco novo (validado localmente): 12 migrations, 8 `products`, 1 `cachaca`, 9 `catalog_items`, 17 `catalog_variants`, **0 administradores**, `cms_ready_publication = 1`, 0 triggers de instalação, 0 versões CMS.

## Armadilha: `migrations list --remote` escreve

O `wrangler d1 migrations list` executa `CREATE TABLE IF NOT EXISTS d1_migrations` antes de listar (mesma rotina do `apply`). **Não use `migrations list --remote`** antes de aplicar: é escrita remota. Use as leituras `SELECT` abaixo.

## Pré-verificações (somente leitura)

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'
npx wrangler d1 info chopp-delivery-prod-db --json
npx wrangler d1 execute chopp-delivery-prod-db --remote --json --command "SELECT count(*) AS objetos FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
npx wrangler d1 time-travel info chopp-delivery-prod-db
```

Conferir: `uuid = fe4492e3-94a4-4f9a-b44c-10a39fe21bd1`, `name = chopp-delivery-prod-db`, `num_tables = 0` e `objetos = 0`. **Anotar o bookmark** do Time Travel (ponto de retorno). Qualquer divergência é **NO-GO**. Backup do estado inicial (banco vazio; confirma que nada preexistia):

```powershell
npx wrangler d1 export chopp-delivery-prod-db --remote --output $env:USERPROFILE\chopp-prod-backups\prod-antes.sql
```

A pasta fica **fora do repositório**.

## Aplicação remota (NÃO executada)

```powershell
npx wrangler d1 migrations apply DELEGAS_DB --remote --config wrangler.production.jsonc
```

O Wrangler lista as 12 migrations e pede confirmação. **Antes de responder `y`, ler no cabeçalho "Resource location: remote" e o nome/UUID do banco: devem ser `chopp-delivery-prod-db` / `fe4492e3-94a4-4f9a-b44c-10a39fe21bd1`.** Qualquer outro nome ou UUID: responder `n`.

## Pós-verificação (somente leitura)

```powershell
npx wrangler d1 execute chopp-delivery-prod-db --remote --json --command "SELECT (SELECT count(*) FROM d1_migrations) AS migrations, (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM cachaca) AS cachaca, (SELECT count(*) FROM catalog_items) AS itens, (SELECT count(*) FROM catalog_variants) AS variantes, (SELECT count(*) FROM admin_users) AS admins, (SELECT count(*) FROM cms_ready_publication) AS pronto, (SELECT count(*) FROM cms_v2_versions) AS versoes_cms, (SELECT count(*) FROM sqlite_schema WHERE name IN ('cms_publication_install_guard','cms_publication_state_install_guard')) AS guards"
npx wrangler d1 export chopp-delivery-prod-db --remote --output $env:USERPROFILE\chopp-prod-backups\prod-migrado.sql
```

Esperado: `migrations 12, products 8, cachaca 1, itens 9, variantes 17, admins 0, pronto 1, versoes_cms 0, guards 0`. O export migrado é o ponto de partida para o bootstrap do administrador (H10.6).

## Falha e recuperação

| Situação | Ação |
|---|---|
| Falha no meio do `apply` | O Wrangler para na migration com erro; as anteriores ficam registradas. Registrar a mensagem (sem segredos), corrigir a causa e repetir o mesmo comando: ele retoma da primeira não aplicada. Não editar `d1_migrations` à mão. |
| Estado inconsistente ou resultado inesperado | Voltar ao bookmark anotado (**escrita remota: exige autorização própria**): `npx wrangler d1 time-travel restore chopp-delivery-prod-db --bookmark=<BOOKMARK_ANOTADO>`. O banco volta a ficar vazio e o `apply` pode ser repetido. |
| Time Travel indisponível | Como o banco não tem dados antes do bootstrap, o último recurso (autorizado e com capacidade livre) é excluir e recriar o D1 vazio; o novo UUID obriga a atualizar `wrangler.production.jsonc` e os bindings. |
| Pós-verificação diferente do esperado | Não prosseguir para o bootstrap. Tratar como NO-GO e investigar antes de qualquer reparo. |

Não há migrations de reversão: a recuperação é por Time Travel ou recriação, nunca por SQL manual.

## GO / NO-GO

**GO para aplicar:** autorização explícita; pré-verificações iguais ao esperado (nome, UUID, 0 objetos); bookmark anotado; export inicial salvo; pasta de backup fora do repositório.

**NO-GO:** UUID ou nome diferentes; banco com objetos; comando sem `--config wrangler.production.jsonc`; confirmação do Wrangler mostrando outro banco.

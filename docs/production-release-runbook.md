# Release completo (pós-`7a71df8`): catálogo dinâmico, imagens de produto e mídia

**Estado: candidato consolidado e validado localmente. Nada foi publicado, migrado nem criado em produção. Cada passo remoto abaixo exige autorização explícita do responsável.**

Alvo: Pages `chopp-delivery-prod`, branch `main`, D1 `chopp-delivery-prod-db` (`fe4492e3-94a4-4f9a-b44c-10a39fe21bd1`), conta `7d8a62a0e64b693184975560c7cb788d`, WhatsApp `5531984400001`.

**Último release PUBLICADO:** `7a71df863c87b4913c29dde93edcf7e29e35a3dd` (deployment `9e876c4d`, 12 migrations). `COMMERCIAL_COMMIT` em `scripts/production-pages-deploy.mjs` é só a **base de ancestralidade** desse release: ela nunca aprova um candidato. Todo `preflight`/`deploy` exige `--commit <SHA completo>` explícito, validado por `checkReleaseCommit` (existente, descendente de `7a71df8`, `HEAD` ou ancestral de `HEAD`, diferente de `7a71df8`). Só atualizar a constante **depois** de o novo release estar publicado e verificado.

## 1. O que entra

Desde `7a71df8`: catálogo comercial dinâmico (categorias, itens e variantes com `rN`), gestão de variantes no painel, mídia editorial no carrossel (publicação bloqueada com mídia indisponível), bootstrap seguro do administrador, gate de mídia fechado por padrão, associação de imagem principal a produtos (migration `0013`), imagem de produto na vitrine e no painel, e a correção do gatilho do catálogo no D1 (migration `0014`, erro `SQLITE_ERROR 7500`).

**Migrations pendentes em produção (nesta ordem):** `0013_catalog_item_media.sql` e `0014_catalog_write_trigger_lighter_ordering.sql`. A `0014` é obrigatória: sem ela o `PUT /api/admin/catalog/v2` falha no D1 remoto (comprovado na homologação). Ambas são aditivas.

Validado em homologação (`dffb3fe` + migrations 0001–0014): escrita real do catálogo, upload e processamento, associação principal com revisões `mN`, conflitos 409, produto oculto, proteção contra exclusão de mídia referenciada, entrega pública `hero`/`section` e preservação dos dados comerciais. O arquivo de relatório e os scripts estão fora do repositório (`chopp-homolog-ensaio`).

## 2. Perfis de configuração e guard

`scripts/production-pages-deploy.mjs` aceita `--profile` (padrão `base`). Cada perfil tem arquivo revisado e hash fixo; qualquer divergência bloqueia.

| Perfil | Arquivo | Quando |
| --- | --- | --- |
| `base` | `wrangler.production.jsonc` | sem R2/serviços; **único perfil válido enquanto a infraestrutura de mídia não existir** |
| `media-closed` | `wrangler.production.media.jsonc` | bindings `CMS_MEDIA_BUCKET` → `chopp-cms-media-production` e `CMS_MEDIA_PROCESSOR` → `chopp-cms-image-processor-production`; `CMS_MEDIA_ENABLED=disabled` |
| `media-open` | `wrangler.production.media-open.jsonc` | idêntico ao anterior, só com `CMS_MEDIA_ENABLED=enabled` |

Os perfis de mídia exigem bindings e variáveis **exatos** (nome do bucket e do serviço, nenhum extra, `env.preview` sem bindings, nada de homologação). No `preflight` o guard lê (somente leitura) se o bucket e o Worker existem; `media-open` exige o gate do Worker **já aberto** e `media-closed` aceita o Worker aberto ou fechado para permitir fechar o Pages primeiro. O bloqueio de infraestrutura do perfil `base` continua integral.

## 3. Os dois gates de mídia e a ordem segura

A mídia só funciona com **dois** gates abertos: `CMS_MEDIA_ENABLED=enabled` (Pages) **e** `CMS_MEDIA_PROCESSOR_ENABLED=enabled` (Worker processador). Com qualquer um fechado, o upload falha (Pages fechado: 404; Worker fechado: 503 `MEDIA_UNAVAILABLE`, `stage=processor.transform`).

| | Pages | Worker processador |
| --- | --- | --- |
| Estado inicial / padrão | `media-closed` (`disabled`) | versão `disabled` |
| **Abrir** | 2º: deploy com perfil `media-open` | 1º: ativar a versão `enabled` |
| **Fechar** | 1º: deploy com perfil `media-closed` | 2º: reativar a versão `disabled` |

Nunca deixar o Pages aberto com o Worker fechado (uploads falham e consomem cota) e nunca fechar o Worker antes do Pages. A sonda do Pages: `PUT /api/admin/catalog/media/dronken` anônimo dá 401 (aberto) ou 404 (fechado). O gate do Worker se lê com `wrangler deployments status --name chopp-cms-image-processor-production` e `wrangler versions view <id> --name …`.

## 4. Fase A: lançamento comercial (sem mídia nova)

Independe da infraestrutura de mídia. Perfil `base`.

1. **Backup e ponto de retorno (leitura):** `wrangler d1 export chopp-delivery-prod-db --remote --output …\prod-pre-0013.sql`, SHA-256 e `wrangler d1 time-travel info chopp-delivery-prod-db` (anotar o bookmark). Conferir `d1_migrations` por `SELECT` (nunca `migrations list --remote`, que escreve).
2. **Migrations (autorização):** `npx wrangler d1 migrations apply DELEGAS_DB --remote --config wrangler.production.jsonc` deve listar **somente** `0013` e `0014`; conferir "Resource location: remote" e o UUID. Depois: 14 migrations, `catalog_ready = 1`, `EXPLAIN UPDATE catalog_write …` sem erro 7500, hash comercial igual ao de antes. As migrations vêm **antes** do deploy (a vitrine nova consulta `catalog_item_media`).
3. **Snapshot e build** (pasta fora do repositório, `git archive $Release`, `wrangler.production.jsonc` como `wrangler.jsonc`):

```powershell
$Release = '<SHA de 40 caracteres do commit do release>'
$Dir = Join-Path $env:TEMP 'chopp-release'
Remove-Item -Recurse -Force $Dir -ErrorAction SilentlyContinue
New-Item -ItemType Directory $Dir | Out-Null
git archive --format=tar -o "$Dir.tar" $Release
tar -xf "$Dir.tar" -C $Dir
Copy-Item wrangler.production.jsonc (Join-Path $Dir 'wrangler.jsonc')
Set-Location $Dir
npm ci --no-audit --no-fund
$env:VITE_WHATSAPP_NUMBER = '5531984400001'   # literal só na sessão; nunca em arquivo
npm run build:commercial                       # typecheck + build release + gate + auditoria
Remove-Item Env:VITE_WHATSAPP_NUMBER
```

4. **Guard e deploy:**

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'
node scripts/production-pages-deploy.mjs preflight --dir $Dir --commit $Release --profile base   # somente leitura
node scripts/production-pages-deploy.mjs command   --commit $Release                              # imprime o comando fixo
# Só com autorização explícita:
node scripts/production-pages-deploy.mjs deploy --dir $Dir --commit $Release --profile base --confirm chopp-delivery-prod
```

5. **Verificação** (seção 7). Depois da publicação, atualizar `COMMERCIAL_COMMIT` para `$Release`.

## 5. Abrir a vitrine sem remover a autenticação do CMS

Hoje o domínio inteiro de produção responde 302 ao Cloudflare Access. O CMS tem **autenticação própria** (sessão F2, origem exata, CSRF): na homologação, após retirar o Access do domínio principal, todas as rotas `/api/admin/*`, `/api/auth/me` e `/admin/preview*` responderam 401 a anônimos, as escritas de mídia 404 com o gate fechado, e `ADMIN_ORIGIN` torna a autenticação indisponível (fail-closed) em qualquer host que não seja o canônico.

Pré-requisitos antes de abrir (decisão do responsável no Zero Trust, **fora do código**): senha do administrador longa (o mínimo aprovado é 8 caracteres; a tela de login fica pública), `ADMIN_PASSWORD_PEPPER` presente no Pages de produção (`wrangler pages secret list --project-name chopp-delivery-prod`, só nomes) e a Fase A já publicada. Alteração: remover os destinos de **produção** da Application do Access (preservando as policies e **sem** tocar na Application da homologação nem em outras). Reversão: readicionar os destinos. Conferir **antes** que a Application de produção não cobre outros hosts.

Sondas anônimas depois de abrir: `/` e `/api/catalog` 200; `/api/admin/catalog`, `/api/admin/catalog/v2`, `/api/admin/media`, `/api/admin/site`, `/api/admin/products`, `/api/auth/me` e `/admin/preview` 401 (ou 404 nas de mídia com o gate fechado); `PUT /api/admin/catalog/media/dronken` 404; qualquer falha reverte o Access.

## 6. Fase B: infraestrutura e habilitação da mídia (cada passo com autorização)

Pré-condição: Fase A publicada e verificada; Cloudflare Images disponível na conta (homologação já validou o binding `IMAGES`).

1. **Bucket privado:** `npx wrangler r2 bucket create chopp-cms-media-production` (sem domínio público nem `r2.dev`).
2. **Worker processador FECHADO:** `npx wrangler deploy --config config/cloudflare/production-media-processor.jsonc` (cria o Worker já com `CMS_MEDIA_PROCESSOR_ENABLED=disabled`). Anotar o ID da versão ativa (`wrangler deployments status --name chopp-cms-image-processor-production`) como `$VersaoFechada`.
3. **Versão ABERTA (enviada, não ativada):** `npx wrangler versions upload --config config/cloudflare/production-media-processor-open.jsonc --message "gate aberto (nao ativar)"`; anotar `$VersaoAberta`.
4. **Pages com os bindings, gate fechado:** `preflight`/`deploy` com `--profile media-closed` (mesmo snapshot do `$Release`, com `wrangler.production.media.jsonc` como `wrangler.jsonc`). Nada abre sozinho.
5. **Janela supervisionada** (backup e bookmark antes; tail ativo no deployment do Pages):
   - **Abrir:** `npx wrangler versions deploy "$VersaoAberta@100" --name chopp-cms-image-processor-production -y`; depois `deploy --profile media-open` do Pages. Sonda anônima 401.
   - Enviar **uma** imagem pequena pelo painel, conferir recibo, derivados no R2 e a entrega; só então usar em produto/publicação.
   - **Fechar (sempre ao final, mesmo com falha):** `deploy --profile media-closed`; depois `npx wrangler versions deploy "$VersaoFechada@100" --name chopp-cms-image-processor-production -y`; sondas: Pages 404, Worker na versão fechada.
6. Se `/api/site/media/*` precisar ficar público com o Access ainda ativo, acrescentá-lo às exceções do Access (Proposta B). Com o Access removido (seção 5) isso não é necessário.

Notas operacionais comprovadas na homologação: o `wrangler` escreve avisos no stderr (não tratar como falha; decidir pela versão ativa lida depois); manter **um** processo de `tail` por vez; ao ler a revisão de uma mídia para `If-Match`, usar o campo `media.revision` do JSON (o `ETag` pode virar fraco no edge).

## 7. Verificação pós-deploy

**API (`/api/products` e `/api/catalog`)**: itens, variantes e preços iguais aos aprovados (9 itens, 17 variantes, 14 com preço e 3 sem, todos visíveis, antes de qualquer edição); `Cache-Control: no-store`; sem campo de estoque; sem `image` enquanto nenhuma imagem principal for associada.

**Vitrine (390 px e 1440 px)**: sem rolagem horizontal; sem retirada; seletor de quantidade começa em 1; Brahma/Kaiser/Heineken 30 L "Indisponível".

**WhatsApp (ler o `href`, sem enviar)**: destino exatamente `https://wa.me/5531984400001`; mensagens com produto, volume, quantidade, unitário e total. Mensagem real só com autorização.

**Painel**: login do CMS; `GET /api/admin/catalog/v2` 200; um `PUT` sem alterações devolve 200 sem mudar a revisão.

**Estado**: `wrangler pages deployment list` mostra o novo deploy de **Production** com o commit `$Release`; D1 com 14 migrations; `CMS_MEDIA_ENABLED=disabled` e Worker `disabled` ao fim de qualquer janela.

## 8. Rollback

- **Frontend:** promover de novo o deployment anterior `9e876c4d` (`7a71df8`) no painel do Pages. Compatível com o banco migrado (0013/0014 são aditivas).
- **Gates de mídia:** fechar na ordem Pages → Worker (seção 3); `deploy --profile media-closed` e `versions deploy "$VersaoFechada@100"`.
- **Access:** readicionar os destinos de produção à Application.
- **D1:** só com autorização separada, Time Travel para o bookmark anotado no passo 1 da Fase A (`wrangler d1 time-travel restore chopp-delivery-prod-db --bookmark=<bookmark>`). As migrations não removem dados; restaurar descarta também qualquer edição feita depois do bookmark.

## 9. O que não está provado por arquivos locais

Equivalência D1 × `/api/products` público, `href` real do WhatsApp publicado, 302/200/401 reais por host depois da mudança de Access, disponibilidade e custo do Cloudflare Images na conta de produção e o comportamento da primeira janela de mídia em produção.

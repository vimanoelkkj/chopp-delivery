# Release comercial consolidado (pós-`bead9d9`)

**Estado: preparado e validado em snapshot isolado. Nada foi publicado, commitado ou escrito no D1. Publicar exige autorização explícita do responsável.**

Alvo (inalterado): Pages `chopp-delivery-prod`, branch `main`, D1 `chopp-delivery-prod-db` (`fe4492e3-94a4-4f9a-b44c-10a39fe21bd1`), conta `7d8a62a0e64b693184975560c7cb788d`, WhatsApp `5531984400001`. Último release publicado: `bead9d9c66be74b48604a045b25ae81f64ae2630`.

## 1. O que entra no release

Correções aprovadas: operação somente delivery; cachaça na vitrine e texto "Sobre" coerente; seletor de quantidade 1–99; total em centavos; mensagem WhatsApp com produto, volume, quantidade, unitário e total; refinamento mobile (tabela, seletor, carrossel); First Paint medido por regiões de fundo; ferramental de deploy com `--commit`.

Lista exata (`git add` explícito; **não** use `git add -A`):

```powershell
git add `
  .gitignore `
  docs/production-cachaca-rename.md `
  docs/production-d1-migrations.md `
  docs/production-release-runbook.md `
  e2e/catalog-atomic-routes.spec.ts `
  e2e/cms-editorial-sections.spec.ts-snapshots/homepage-1440-dom-win32.json `
  e2e/cms-editorial-sections.spec.ts-snapshots/homepage-1440-win32.png `
  e2e/cms-editorial-sections.spec.ts-snapshots/homepage-390-dom-win32.json `
  e2e/cms-editorial-sections.spec.ts-snapshots/homepage-390-win32.png `
  e2e/order-quantity.spec.ts `
  e2e/storefront-dark-theme.spec.ts-snapshots/storefront-dark-1440-win32.png `
  e2e/storefront-dark-theme.spec.ts-snapshots/storefront-dark-390-win32.png `
  e2e/storefront-first-paint.spec.ts `
  scripts/pages-tail-client.mjs `
  scripts/pages-tail-client.test.mjs `
  scripts/pages-tail-sanitizer.mjs `
  scripts/pages-tail-sanitizer.test.mjs `
  scripts/production-account-guard.d.mts `
  scripts/production-account-guard.mjs `
  scripts/production-pages-deploy.d.mts `
  scripts/production-pages-deploy.mjs `
  src/features/admin/AdminShell.tsx `
  src/features/admin/catalog/putContract.test.ts `
  src/features/admin/site/CarouselEntries.tsx `
  src/features/admin/site/CatalogGatewayContext.tsx `
  src/features/admin/site/initialDocument.ts `
  src/features/catalog-expansion/CachacasShowcase.tsx `
  src/features/catalog-expansion/ExpandableCatalogView.tsx `
  src/features/catalog-expansion/catalog-expansion.test.ts `
  src/features/catalog/BarrelCarousel3D.module.css `
  src/features/catalog/BarrelCarousel3D.tsx `
  src/features/catalog/CachacaBanner.tsx `
  src/features/catalog/KegCardsGrid.tsx `
  src/features/catalog/PriceComparison.module.css `
  src/features/catalog/PriceComparison.tsx `
  src/features/catalog/catalog-redesign.test.tsx `
  src/features/catalog/commercial-orders.test.tsx `
  src/features/contact/messages.ts `
  src/features/motion/TickerMarquee.tsx `
  src/features/motion/ticker-marquee.test.ts `
  src/pages/landing/sections/AboutSection.tsx `
  src/pages/landing/sections/HeroRefined.tsx `
  src/pages/landing/sections/__snapshots__/editorial.test.tsx.snap `
  src/shared/lib/quantity.ts `
  src/shared/ui/QuantityStepper.module.css `
  src/shared/ui/QuantityStepper.tsx `
  tests/backend/production-d1-migrations.test.ts `
  tests/backend/production-pages-deploy.test.ts `
  tests/e2e-real/admin-real.spec.ts `
  wrangler.production.jsonc
```

**Fica fora** (continua local, sem entrar no commit): `prototypes/dark-d4a/`, `wrangler.homologation*.jsonc`, `docs/immersive-cms-stage4-spec.md`, `graphify-out/`, `.env*`, `.dev.vars*`, `.wrangler/`.

**Bootstrap de produção (versionado à parte).** O conjunto do bootstrap do administrador (`server/auth/bootstrap.ts`, `password-policy.ts`, `production-bootstrap-worker.ts`, `scripts/bootstrap-admin.mjs`, `scripts/production-bootstrap-config.*`, `config/cloudflare/production-bootstrap-worker.jsonc`, os testes `password-policy` e `production-bootstrap-*`, `docs/production-bootstrap-runbook.md`) tem commit próprio e deixou de ser trabalho local. A política de senha aprovada é de 8 a 128 caracteres (até 512 bytes, sem senhas triviais). O Worker nasce desarmado e o runbook do bootstrap é o procedimento vigente; este documento não o substitui.

Nenhum arquivo da lista altera `functions/` ou `server/`: o runtime das Functions é o do `bead9d9`. O release muda o frontend, testes e ferramental.

## 2. Versionamento e snapshot

1. O responsável cria **um commit** com a lista acima e anota o SHA completo (`$Release`). Ele tem de descender de `bead9d9` e ser `HEAD` ou ancestral de `HEAD`.
2. O deploy sai de um diretório **fora do repositório**, criado por `git archive $Release` (mesmo método do `bead9d9`), com `wrangler.production.jsonc` copiado como `wrangler.jsonc`:

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

3. Conferências do artefato (`dist-commercial/`): o único número no bundle é `5531984400001`; sem `delegas-local-only`, `homolog`, `dark-d4a`, `Temos cachaça`, `latas nem garrafas`, `Delivery e retirada`; presentes `Somos especialistas dedicados na cadeia do barril de chopp e também entregamos cachaça em garrafa`, `Sem retirada` e `Zero Retirada` (delivery exclusivo). `dist-commercial.audit.json` fica **fora** do que é publicado.

O snapshot de validação desta preparação (HEAD `bead9d9` + arquivos da lista) construiu sem erro, `checkDeployDir` retornou vazio e o hash de `wrangler.production.jsonc` é igual ao `PRODUCTION_CONFIG_SHA256`.

## 3. Deploy (guardas preservados, agora com `--commit`)

`scripts/production-pages-deploy.mjs` continua recusando `--config`, `--env`, branch diferente de `main`, D1 de laboratório/homologação, `wrangler.jsonc` diferente do revisado e snapshot divergente do commit. **Novo:** `preflight` e `deploy` exigem `--commit <SHA completo>`, validado por `checkReleaseCommit` (40 hex minúsculos, existente, descendente de `bead9d9`, igual a `HEAD` ou ancestral dele e diferente de `bead9d9`). A constante `COMMERCIAL_COMMIT` passa a significar "último release publicado" (base de ancestralidade); o `--commit-hash` do Pages é o `$Release`.

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'
node scripts/production-pages-deploy.mjs preflight --dir $Dir --commit $Release   # somente leitura
node scripts/production-pages-deploy.mjs command   --commit $Release              # imprime o comando fixo
# Só com autorização explícita:
node scripts/production-pages-deploy.mjs deploy --dir $Dir --commit $Release --confirm chopp-delivery-prod
```

Depois da publicação, atualizar `COMMERCIAL_COMMIT` para `$Release` (e os testes que o citam) como último release publicado.

## 4. D1: renomear a cachaça

Procedimento separado e reversível em [production-cachaca-rename.md](production-cachaca-rename.md). É só dado, independe do deploy do frontend e pode vir antes ou depois dele.

## 5. Verificação pós-deploy

Tudo atrás do Cloudflare Access: usar sessão Access existente do responsável (navegador logado). **Nunca** seguir links `wa.me` até o envio: interceptar a navegação e ler o `href`.

**API (`/api/products` e `/api/catalog`)**
- 9 itens, 17 variantes, 14 com preço e 3 sem (Brahma, Kaiser e Heineken 30 L), todos visíveis.
- Preços iguais à tabela aprovada (30/50 L): Dronken 510/650, Palato Beber 490/640, Villa Alemã 520/670, Krug Bier 570/760, Brahma —/890, Kaiser —/890, Heineken —/990, Chopp de vinho 570/790; cachaça 700 ml = 30,00.
- Depois do rename: `cachaca.title = "Cachaça Artesanal"` (antes: `Temos cachaça`).
- `Cache-Control: no-store` e nenhum campo de estoque.

**Vitrine (390 px e 1440 px)**
- Sem rolagem horizontal; sem retirada oferecida; cachaça visível com o nome novo.
- Tabela e cards: seletor começa em 1; "−" desabilitado em 1; Dronken 30 L: 2 → Total R$ 1.020; 3 → Total R$ 1.530; trocar litragem ou barril volta a 1.
- Brahma/Kaiser/Heineken 30 L: "Indisponível", sem seletor nem pedido.
- Carrossel: volume e preço da variante ativa; quantidade e total acompanham a variante.

**WhatsApp (ler o `href`, sem enviar)**
- Destino exatamente `https://wa.me/5531984400001`.
- Barril: `Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de <Produto> (<30L|50L>). Quantidade: <n> <unidade|unidades>. Preço unitário: R$ <valor>. Total: R$ <valor>.`
- Cachaça: `Olá! Gostaria de adicionar a Cachaça Artesanal (Garrafa - 700ml) ao meu pedido. Quantidade: <n> <unidade|unidades>. Preço unitário: R$ 30,00. Total: R$ <n×30,00>.`
- Mensagem de teste real no WhatsApp só com autorização do responsável.

**Segurança e estado**
- `/`, `/admin` e `/api/*` continuam respondendo 302 ao Access sem credencial (produção, host do deploy e `main`).
- `wrangler pages deployment list` mostra o novo deploy de **Production** com o commit `$Release`.
- D1 pós-verificação conforme o runbook de renomeação (contagens, soma de preços, revisão R+1).

**Reversão**
- Frontend: promover de novo o deploy anterior (`bead9d9`) no painel do Pages (exige autorização).
- D1: `UPDATE` inverso guardado ou Time Travel, conforme `production-cachaca-rename.md`.

## 6. Verificações que exigem acesso autenticado

Equivalência D1 × `/api/products` público, `href` real do WhatsApp publicado, nome novo da cachaça na API, 302 do Access nos três hosts e o deploy listado no Pages. Nada disso é provável a partir de arquivos locais.

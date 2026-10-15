# F3C.2 — painel com backend real local

O modo `admin-integration` conecta o painel à autenticação F2 e ao catálogo administrativo v2 reais. Não habilita o painel no build publicável e não liga os componentes de prévia AG à LandingPage.

## Executar com segurança

No worktree de integração, com as dependências já instaladas:

```powershell
Set-Location 'C:\Users\zZzZz\Projetos\chopp-delivery-integration'
npm run dev:admin:real
```

Abra `http://127.0.0.1:4185/admin`. O terminal informa o usuário `delegas-local` e uma senha aleatória temporária. Use exatamente essa origem (não troque por `localhost`). Para outra porta, defina `$env:DELEGAS_INTEGRATION_PORT='4186'` antes de iniciar.

Cada execução:

1. Cria um diretório exclusivo `delegas-admin-integration-*` no TEMP do sistema, com marcador de propriedade, ID de D1 e pepper aleatórios.
2. Compila o frontend com `--mode admin-integration` para esse diretório, sem carregar arquivos `.env` do operador. Não sobrescreve `dist`.
3. Compila as Pages Functions existentes com Wrangler. O compilador e o runtime local usam `nodejs_compat`, exigido pelo bundle gerado pela versão instalada do Wrangler.
4. Executa as migrations 0001–0005 com **`--local`**, configuração e persistência temporárias explícitas. A migration 0005 continua única, sem dual-write.
5. Inicia um único Miniflare/workerd em loopback, com Functions e assets na mesma origem, e cria o proprietário usando o bootstrap F2 existente.
6. Mantém as gravações no D1 durante a execução, inclusive ao recarregar o navegador. Ctrl+C encerra o runtime antes de apagar seu diretório e SQLite/WAL.

Não aceita caminho de banco existente. Não lê `.dev.vars`, não reutiliza `.wrangler/state` ou `.wrangler/e2e-state`, não chama D1 remoto e não usa credenciais Cloudflare. A senha só existe nesta instância e não entra no bundle. O cookie local continua HttpOnly/SameSite=Strict, com HTTP de loopback permitido explicitamente pela F2.

Interrupções durante compilação/migrations aguardam o comando finito terminar/falhar e então limpam o diretório. Encerramento forçado do processo, falta de energia ou falha inesperada de descarte podem deixar TEMP residual; ele nunca é reutilizado automaticamente. Uma falha de descarte diferente do erro original de inicialização preserva os arquivos em vez de removê-los enquanto um runtime pode estar vivo.

## Seleção de modos

| Execução | Catálogo administrativo | `/admin` |
| --- | --- | --- |
| `npm run dev:admin:real` | HTTP F2/v2 + D1 descartável | Integração real explícita |
| `npm run dev:admin:mock` | Mock isolado, com aviso visível | Apenas Vite DEV `admin-mock` |
| Playwright existente, `--mode e2e` | Mock explícito dos testes de interface | Preservado para as suítes existentes |
| `npm run dev` ou build normal | Nenhum gateway administrativo | `AdminDisabled` |

O mock simula somente o catálogo; não cria um bypass de autenticação. As suítes isoladas configuram suas sessões explicitamente. `?mock=` é ignorado no modo real. Falha da API real aparece como erro, sem troca de gateway ou catálogo estático. `npm run build` e `npm run verify:dist` continuam obrigatórios para o artefato publicável; não publique o artefato temporário de integração.

## Contrato e recuperação

- GET `/api/auth/me`, POST `/api/auth/login` e `/api/auth/logout`: F2 existente, cookie da mesma origem e Origin validada nas escritas.
- GET `/api/admin/catalog/v2`: snapshot com revisão opaca, categorias, itens ocultos e `creationRef` persistentes.
- PUT nessa mesma rota: `If-Match: "<revision>"`, corpo `{revision,categories:[{id,name,items}]}` completo; itens novos/variantes novas enviam `clientId: tmp:<UUID>`, persistidos enviam `id`/`code`. Sem exclusão por omissão.
- Valores enviados são centavos inteiros e ml inteiros; `priceCents: null` permanece indisponível. O painel lê os IDs/codes definitivos e a revisão devolvida pelo servidor. Não pressupõe incremento unitário da revisão.
- A autorização transacional, CSRF, revisão otimista, validação, SQL e migration existentes não foram alterados.
- Resposta perdida gera confirmação por GET, nunca PUT automático adicional. Se nada foi gravado, o rascunho fica disponível para uma tentativa explícita. Se houve commit, o rebase resolve referências inclusive de variantes novas em itens persistidos e converte litros para a representação persistida em ml.
- Durante PUT/GET de reconciliação, a edição fica temporariamente bloqueada. Se a confirmação também falhar, nome/preço e outros dados não estruturais podem continuar no rascunho, mas criar/remover cadastros ou variantes, descartar, editar rótulo/volume ficam bloqueados até a confirmação. Isso impede omitir identidades que já podem existir no banco. Rótulo/volume de variantes persistidas continuam somente leitura, conforme F3B.
- Expiração guarda o rascunho apenas em memória, para o mesmo usuário **e** a mesma revisão. Recarregar a página perde alterações não salvas; dados confirmados vêm novamente do D1.

## Provas reproduzíveis

```powershell
npm run typecheck
npm run lint
npm test -- tests/backend/admin-panel-integration.test.ts tests/backend/admin-integration-runtime.test.ts
npm test -- --maxWorkers=2
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e:real
$env:PLAYWRIGHT_PORT='4193'
npm run test:e2e -- --workers=2
npm run build
npm run verify:dist
git diff --check
```

A configuração real preserva a seleção existente por `PLAYWRIGHT_CHANNEL` ou `CHROMIUM_PATH`; não baixa navegadores. Cada teste real cria e remove seu próprio D1, respeitando o rate limit sem limpar buckets ou enfraquecer autenticação. O servidor Node separado evita herdar o carregador Playwright nas threads RPC do Miniflare. A conexão SQLite adicional dos testes aponta exclusivamente para o diretório criado por essa fixture; permite conferir persistência e preparar expiração, sem endpoint de teste na aplicação.

| Cenário | Evidência |
| --- | --- |
| A | Login F2 real, cookie HttpOnly/Strict e catálogo real |
| B/M/N | PUT construído pela UI com If-Match; `510,29` → SQLite `51029`; recarga mantém `510,29` |
| C/L | Novo chope: variantes `20000 ml / 12345` e `7500 ml / null`; IDs definitivos e creationRefs no D1 |
| D | Nova cachaça: `700 ml / 2501` no D1 e após recarga |
| E | Oculto no admin; ausente do GET público; sem apagar registro |
| F | Duas sessões reais: uma resposta 200, outra 409, somente o vencedor persistido |
| G | Logout e expiração reais recusam gravação; catálogo intacto; rascunho restaurado após novo login compatível |
| H | Origin inválida enviada ao handler real recebe 403; resposta genuína é encaminhada à UI, que explica a recusa |
| I/J | Corte de rede antes/depois do handler; GET real distingue não aplicado/aplicado, contagem exata de um PUT |
| K | Criação incerta, GET inicialmente indisponível, edição posterior de nome/preço preservada; confirmação GET e segundo salvamento explícito mantêm `20000 ml / 12789` |

Vitest também prova o rebase de variante nova em produto já persistido. Os testes do runtime verificam sucesso/encerramento e falha por porta ocupada, sem diretório ou listener residual. As interceptações Chrome cortam transporte ou encaminham respostas reais: não fabricam catálogo, autenticação ou sucesso de escrita.

## Limites restantes

Esta prova é local. Não comprova quotas, comportamento de borda Cloudflare, latência ou concorrência distribuída em produção. O modo de integração e o HTTP local não são configuração de deploy. O painel público continua desativado; sua ativação exige autorização e revisão próprias. Nenhum estoque, pedido, promoção, CMS ou pagamento foi acrescentado.

## Fechamento da validação local

Branch `integration/delegas-f3`, base/HEAD `1d98c48185842f389ec8c5f3af7479283d10e154`, sem commit ou staging da F3C.2.

| Gate | Resultado |
| --- | --- |
| Typecheck frontend/backend | Aprovado, inclusive pelo build normal final |
| Biome | Aprovado |
| Vitest completo, `--maxWorkers=2` | 732/732, 50 arquivos, 130,73 s |
| Integração nova de handlers/D1 + ciclo do runtime | 13/13, incluídos no Vitest completo |
| Fronteiras/gates do frontend, após preservar a asserção original do mock | 6/6 |
| Chrome real + Pages Functions/D1 descartável | 10/10, 1,2 min; A–N e confirmação mesmo após desfazer a edição |
| Chrome, E2E existentes, porta 4193 / dois workers | 133/133, 2,0 min; nenhum teste existente alterado |
| Build normal + `verify:dist` | Aprovados; somente AdminDisabled, sem AdminApp/mocks/fixtures; 5 arquivos textuais verificados |
| `git diff --check` | Aprovado |

Na primeira execução do Vitest com paralelismo padrão, houve 731/732: o teste existente de orçamento máximo excedeu o timeout de 5 s. Isolado, passou (arquivo em 3,18 s); a suíte completa com dois workers passou sem aumentar timeout, reduzir orçamentos ou alterar asserções. Resta a sensibilidade desse teste à contenção local; recomenda-se o comando de dois workers acima. A porta 4173 estava ocupada; a instância existente foi preservada.

O storefront e os arquivos `server/`, `functions/`, `shared/`, `migrations/` e `e2e/` existentes não têm diff. As mudanças visíveis estão restritas ao admin: bloqueio temporário de controles para integridade e aviso no modo fictício explícito.

### Arquivos da F3C.2

| Grupo | Arquivos criados/alterados |
| --- | --- |
| Modos/entrada | `src/app/App.tsx`; `src/features/admin/AdminApp.tsx` |
| Gateway/estado | `src/features/admin/catalog/httpGateway.ts`; `draft.ts`; `useCatalogEditor.ts` |
| Controles do painel | `src/features/admin/catalog/CatalogView.tsx`; `CatalogView.module.css`; `ItemCard.tsx`; `src/features/admin/ui/TextField.tsx` |
| Execução/tipos | `scripts/dev-admin-integration.mts` (novo); `playwright.real.config.ts` (novo); `package.json`; `tsconfig.backend.json` |
| Testes D1 | `tests/backend/admin-panel-integration.test.ts` (novo); `tests/backend/admin-integration-runtime.test.ts` (novo) |
| Chrome real | `tests/e2e-real/admin-real.spec.ts` (novo); `tests/e2e-real/server.mts` (novo) |
| Fronteiras existentes | `tests/frontend/admin-production-gate.test.ts`; `tests/frontend/admin-gateway-boundary.test.ts` |
| Documentação | `docs/admin-integration-local.md` (novo); `docs/admin-panel-handoff.md` |

Total: 21 arquivos. Sem dependências novas, sem alteração do lockfile e sem artefatos temporários no diff.

**Parecer: GO para revisão/commit local da F3C.2, com as notas operacionais acima.** Nenhum deploy, habilitação do painel público ou commit está autorizado por este parecer.

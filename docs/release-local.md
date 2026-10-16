# L0A.1 — release seguro, validação exclusivamente local

Base: `integration/delegas-f3`, `de698a0bd758fce14c067704ea2a7546a9d007a5`.
Esta etapa prepara o artefato frontend. Não provisiona usuários, não altera a autenticação F2,
não cria recursos Cloudflare e não autoriza publicar o site. CMS e mídia estão fora do escopo.

## Contrato dos modos

| Comando/modo | `/admin` | Catálogo administrativo | Saída padrão |
| --- | --- | --- | --- |
| `npm run build` / `production` | `AdminDisabled` | Não incluído no frontend | `dist/` |
| `npm run build:release` / `release` | Painel real | Somente HTTP, mesma origem | `dist-release/` |
| `npm run dev:admin:real` / `admin-integration` | Painel real local | HTTP, Functions e D1 descartável | TEMP próprio |
| `npm run dev:admin:mock` / DEV `admin-mock` | Painel de laboratório | Mock explícito | Servidor DEV |
| Build `--mode e2e` | Painel de testes | Mock explícito | `dist/`; não publicável |

Release exige `NODE_ENV=production`. Mode e NODE_ENV são diferentes: compilar o release como
desenvolvimento deve falhar. O build normal mantém `verify:dist`; `verify:release` não o substitui.

Release usa base absoluta `/` para resolver chunks também em `/admin/`. O roteador existente
reconhece somente `/admin` e `/admin/`; não implementa rotas CMS. As futuras telas deverão manter
o mesmo limite autenticado e gateway HTTP. `/api/admin/site` ainda devolve 404 JSON.

## Build e verificação

```powershell
npm.cmd run build
npm.cmd run verify:dist
npm.cmd run build:release
npm.cmd run verify:release
```

`build:release` executa typecheck, build e verificador. Não faz deploy. A saída configurada no
Wrangler permanece `dist/`; nenhuma configuração remota foi preparada nesta etapa.

O plugin registra os módulos transitivos dos chunks do próprio build e SHA-256 de todos os
arquivos emitidos, inclusive assets copiados. `dist-release.audit.json` fica FORA da pasta
publicável; ambos são ignorados pelo Git. Não publicar o relatório ou a raiz do repositório.

`verify:release` exige o relatório, compara inventário e hashes, exige `AdminApp` e `httpGateway`,
rejeita mocks, fixtures, laboratório, testes e ferramentas internas, e procura literais exclusivos
de laboratório/mock no artefato. Arquivo extra, removido ou modificado invalida a verificação.
Falhas retornam exit code diferente de zero. Para uma cópia local, preservar o relatório irmão:

Arquivos de ambiente, bancos locais, logs, mapas de depuração e arquivos/pastas identificados
como mocks ou fixtures também são proibidos quando copiados por `public/`, mesmo com hash válido.
JSON e outros formatos textuais são inspecionados além de JS, CSS e HTML.

```powershell
node scripts/check-release-bundle.mjs C:\caminho\para\dist
```

O relatório será `<diretorio>.audit.json`. Isso detecta contaminação acidental; não é assinatura
contra quem pode adulterar simultaneamente artefato, relatório e ferramentas de build.
Novos diretórios DEV exigem atualização da política e de seus testes negativos.

## Ambiente e segurança

Release desativa a exposição automática de `VITE_*`. A única configuração de aplicação
explicitamente compilada é `VITE_WHATSAPP_NUMBER`, já usada pela vitrine. É dado público, não
credencial. Não colocar segredos nesse valor. A configuração comercial publicada virá no CMS.

`ADMIN_PASSWORD_PEPPER`, `ADMIN_ORIGIN`, cookies e credenciais de operador não são configuração
frontend. Sessão, CSRF, autorização SQL, revisão do catálogo e handlers F2 permanecem intactos.
Não existe bypass, login estático ou bootstrap público.

`?mock=...` e `?preview` não escolhem gateway no release. Falha da API de sessão mantém a tela de
indisponibilidade; falha da API administrativa mantém erro, sem catálogo simulado. O painel é
carregado sob demanda. Seu código não é segredo: a proteção dos dados permanece no backend.

## Prova local com Chrome e D1 descartável

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:e2e:release
npm.cmd run test:e2e:real
npm.cmd run test:e2e
```

Executar sequencialmente. Preservados canal Chrome, `CHROMIUM_PATH` e Chromium padrão para CI.
Release reaproveita handlers e cenários reais, alterando o modo de build. O fixture gera
credenciais efêmeras e D1 exclusivo no TEMP; não aceita banco do operador. O teste do build normal
mantém `runtimeMode: production` explicitamente. Nenhum navegador adicional é baixado.

A allowlist dos processos filhos permanece igual. A opção release não amplia variáveis herdadas.
A porta continua validada pelo helper compartilhado. HTTP local usa o cookie local já aprovado;
não comprova HTTPS, cookies Secure ou infraestrutura Cloudflare de produção.

## Evidências desta execução

Execução de 15/10/2026, Chrome instalado, sem download de navegador:

| Gate | Resultado |
| --- | --- |
| Typecheck frontend/backend | Passou, inclusive nos dois comandos de build |
| Biome | 275 arquivos, sem erros |
| Vitest, execução padrão | 1009/1010; um timeout em `expansion-budget.test.ts` |
| Orçamento D1 isolado | 2/2; arquivo concluído em 3,07 s |
| Vitest completo, `--maxWorkers=2` | 1010/1010, 61 arquivos; execução final 128,95 s |
| E2E Chrome release | 21/21, 2,4 min |
| E2E Chrome integração | 21/21, 2,4 min |
| E2E Chrome tradicional | 154/154, 37,8 s, porta 4273 |
| DEV/StrictMode Chrome | 3/3 |
| Build normal e `verify:dist` | Passaram; 89 módulos e 129 literais verificados |
| Build release e `verify:release` | Passaram; 137 módulos, 133 literais, 23 arquivos vinculados por hash |
| npm audit | Zero vulnerabilidades; dependências e lockfile intactos |

O resumo textual dos verificadores menciona cinco arquivos textuais; os hashes do release cobrem
todos os 23 arquivos. A suíte release inclui um cenário explicitamente `production`, preservando
a prova do build normal. A suíte de integração inclui os dois cenários novos explicitamente
release. Não se trata de 42 testes independentes novos.

Os seis testes Vitest novos cobrem presença do HTTP/ausência de mocks no grafo real, contaminação
DEV forçada, adulteração do artefato, arquivo estático proibido com hash correto, exit code do CLI,
segredos não expostos no ambiente frontend, extração JSX e rejeição de NODE_ENV de desenvolvimento.
Os dois E2E novos verificam `/admin/`, cookie inválido, queries mock/preview, namespace CMS ainda
ausente e indisponibilidade real da verificação de sessão. Os cenários existentes exercitam F2,
CSRF, logout/expiração, conflitos, respostas perdidas, D1 e vitrine/WhatsApp desktop/mobile.

Ocorrências e investigação, sem alterar timeouts, asserções ou concorrência padrão dos runners:

- O primeiro Vitest completo atingiu 5,013 s no teste existente de 128 itens/512 variantes, com
  timeout de 5 s. O mesmo arquivo passou isoladamente; duas execuções completas com dois workers
  passaram. Isso é compatível com influência de carga, mas não demonstra a causa definitiva.
  A execução padrão não é declarada integralmente aprovada. O comando `npm test` não foi alterado.
- A primeira tentativa tradicional não executou testes: a porta 4173 estava ocupada. Seu processo
  foi preservado. Com `$env:PLAYWRIGHT_PORT='4273'`, os 154 testes passaram sem retries.
- Um teste novo inicialmente interceptava `/api/auth/session`, rota inexistente, em vez de
  `/api/auth/me`. A interceptação foi corrigida e os dois cenários passaram nas suítes completas;
  foi erro do teste novo, não evidência de intermitência da aplicação.
- O primeiro comando sem elevação não pôde escrever o cache Vite fora da raiz gravável do sandbox.
  Os gates foram executados com autorização de execução local no worktree solicitado.

Logs fora do repositório, em `$env:TEMP`, prefixo `delegas-l0a1-`: `vitest-20261015.log`,
`vitest-workers2-20261015.log`, `vitest-final-workers2-20261015.log`,
`e2e-release-20261015.log`, `e2e-integration-20261015.log`,
`e2e-traditional-20261015.log`, `e2e-traditional-4273-20261015.log` e
`e2e-dev-20261015.log`. Avisos npm em stderr podem ser apresentados como `NativeCommandError`
pelo PowerShell; os exit codes e os resumos dos runners são os resultados considerados.

## Inventário para revisão (sem staging)

Alterados: `.gitignore`, `README.md`, `package.json`, `vite.config.ts`,
`scripts/bundle-guard.mjs`, `scripts/bundle-guard.d.mts`, `scripts/dev-admin-integration.mts`,
`src/app/App.tsx`, `src/features/admin/AdminApp.tsx`, `src/features/admin/AdminDisabled.tsx`,
`tests/e2e-real/admin-real.spec.ts` e `tests/e2e-real/server.mts`.

Novos: este documento, `playwright.release.config.ts`, `scripts/check-release-bundle.mjs` e
`tests/frontend/release-bundle.test.ts`.

São 16 pendências: 12 arquivos rastreados alterados e quatro novos. Não há mudança funcional em
backend, autenticação, migrations, contratos comerciais, catálogo ou layout. O comentário do
AdminDisabled foi atualizado para distinguir o gate normal do release explícito.

Pronto para auditoria independente, com a ressalva operacional do Vitest registrada.
Não equivale a GO para commit ou lançamento. Não houve staging, commit ou operação remota.

## Pendências para L0A.2 e lançamento

- Ambientes/bindings, domínio, HTTPS e secrets reais, mediante autorização posterior.
- Provisionamento operacional do administrador, sem bootstrap público.
- Headers, cache, observabilidade, quotas e recuperação no ambiente real.
- Prova de processamento de mídia e custos; R2/Images não foram acrescentados.
- Textos comerciais e WhatsApp aprovados; CMS futuro substituirá a configuração compilada.
- Manutenção do verificador ao acrescentar módulos CMS.
- Intermitência histórica sob Wrangler/concorrência: testes verdes não demonstram sua causa.

Referência: [Vite — Env Variables and Modes](https://vite.dev/guide/env-and-mode).

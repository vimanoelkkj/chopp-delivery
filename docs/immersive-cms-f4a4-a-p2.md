# F4A.4-A — P2: segurança e isolamento da futura prévia

## Escopo e baseline

Branch `integration/immersive-cms-f4a`; HEAD `9c7690ad507f5a7594fc5a0dcbfeef169d523368`, índice vazio. Referências normativas: pedido P2 e `docs/immersive-cms-f4a4-a.md`. A arquitetura original do Claude foi entregue em conversa, sem documento local; nenhuma funcionalidade adicional foi inferida dela.

Somente cabeçalhos estáticos, correção comprovada da resolução de assets, fidelidade do harness Pages e testes. Nenhum componente React, handler, repositório, contrato CMS, migration, iframe, editor, rota de mídia ou publicação foi alterado/criado. P3 não iniciado. Nenhum commit ou operação remota.

## Diagnóstico comprovado antes da implementação

Uma cópia descartável do build normal foi servida pelo Wrangler Pages dev 4.151.0, em `127.0.0.1:4220`, com configuração própria sem bindings de banco, sem credenciais herdadas. No baseline, `/admin`, `/admin/preview` e `/admin/preview/frame` retornaram HTTP 200 HTML, `Cache-Control: public, max-age=0, must-revalidate`, `Referrer-Policy: strict-origin-when-cross-origin`, sem CSP nem X-Robots-Tag. Nos caminhos profundos, `./assets/...js` resolveu respectivamente para `/admin/assets/...js` e `/admin/preview/assets/...js`, ambos HTTP 200 **text/html**, por causa do fallback SPA. Isso impede inicialização correta; status 200 sozinho seria um falso positivo.

A introdução experimental de `_headers` apenas nessa cópia produziu os cinco headers esperados nos três caminhos, mas não corrigiu os scripts relativos. Dois E2E novos, executados antes da implementação, falharam nos modos normal e release pela ausência de `no-store`: `red-e2e.log`. O probe preserva a evidência independente do problema de assets: `pages-probe.json`, `pages-baseline.log`, `pages-headers.log`.

O harness anterior usava o servidor de assets de **Workers/Miniflare**, que não interpreta o arquivo Pages `_headers`. O experimento com `unstable_generateASSETSBinding` reproduziu os headers do CLI Pages. Não foi adicionado um mock de headers ao teste: o harness passou a usar o interpretador oficial Pages da dependência Wrangler já instalada, inclusive `_redirects` e fallback.

Referências oficiais consultadas: [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/) e [Serving Pages / SPA](https://developers.cloudflare.com/pages/configuration/serving-pages/). `_headers` configura respostas estáticas, não respostas geradas por Functions. Redirecionamentos têm prioridade sobre suas regras. A ausência de um 404.html raiz habilita o fallback SPA. A confirmação local não substitui validação futura no Cloudflare remoto.

## Implementação mínima

| Arquivo | Alteração / motivo |
| --- | --- |
| `public/_headers` | Regras distintas para `/admin` e `/admin/*`; sem sobreposição na mesma resposta. |
| `vite.config.ts` | `base: '/'` nos modos do projeto, coerente com o Pages na raiz; corrige o MIME/URL dos scripts nas rotas profundas. |
| `scripts/dev-admin-integration.mts` | ASSETS utiliza o SDK Pages real, preservando o Worker de Functions, D1 próprio, autenticação e binding privado de mídia apenas quando explicitamente habilitado. AbortSignal fecha o watcher antes da limpeza do diretório de posse. |
| `tests/e2e-real/admin-real.spec.ts` | Dois testes novos, um por modo; blocos legados preservados. |
| `docs/immersive-cms-f4a4-a-p2.md` | Este relatório. |

O SDK está marcado unstable pelo Wrangler. A adaptação explícita de tipos Request/Response e Logger ocorre somente na fronteira Node do harness, não no código publicado. A resposta conserva status, headers e stream; o comportamento foi exercitado nos testes completos. Atualizações do Wrangler exigem revalidar esta fronteira.

## Política e compatibilidade

Nos três caminhos canônicos: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` e a CSP abaixo.

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'self'
```

Scripts e chunks Vite são externos e locais; fontes são locais; APIs são same-origin. Scripts inline e eval não são liberados. `style-src-attr` permite os atributos de estilo efetivamente usados pelo catálogo e carrossel; o fallback `style-src` contempla navegadores sem essa diretiva, enquanto `style-src-elem` permanece restrita a self. Não foram introduzidos nonces fictícios, hosts externos ou permissões para bytes privados. Links WhatsApp continuam navegações, sem dependência de connect-src externo.

`frame-src 'none'` reflete a inexistência de iframe neste checkpoint. `frame-ancestors 'self'` restringe enquadramento a same-origin. Uma futura prévia exige revisão explícita de sandbox, CSP e fluxo de dados no checkpoint autorizado; esta política não aprova nem implementa P3.

`/admin` apresenta o painel indisponível no build normal e o login real no release. `/admin/preview` e `/admin/preview/frame` continuam apresentando a homepage pública pelo fallback existente: **não há prévia editorial implementada**. Não se ampliou o roteamento React. A regra não afeta `/` ou `/administrator`. O redirect preexistente `/admin/` → `/admin` permanece; a proteção descrita é a da resposta canônica final, não uma promessa de headers no redirect 301.

HTML estático e noindex não autorizam leitura de CMS. As APIs continuam exigindo sessão F2, autorização e origem/CSRF; suas respostas são produzidas por Functions, com `no-store` e `nosniff` próprios em `server/auth/http.ts`. Não se atribui a `_headers` proteção dos endpoints `/api/admin/*`.

## Evidência HTTP e testes adversariais

| Build | Rota | HTML | Script resolvido | Headers |
| --- | --- | --- | --- | --- |
| normal | `/admin` | 200 text/html | 200 application/javascript | 5/5 |
| normal | `/admin/preview` | 200 text/html | 200 application/javascript | 5/5 |
| normal | `/admin/preview/frame` | 200 text/html | 200 application/javascript | 5/5 |
| release | `/admin` | 200 text/html | 200 application/javascript | 5/5 |
| release | `/admin/preview` | 200 text/html | 200 application/javascript | 5/5 |
| release | `/admin/preview/frame` | 200 text/html | 200 application/javascript | 5/5 |

Probe final do CLI Pages: `pages-final.json`, `pages-final-normal.log`, `pages-final-release.log`. CLI com o Worker das Functions existentes compilado, sem bindings de banco; integração API/D1 demonstrada separadamente pelos E2E reais.

Os dois E2E cobrem os três caminhos e ambos os modos, exigindo:

- HTTP 200 HTML e os cinco headers exatos, com diretivas CSP críticas explícitas.
- Cada script apontado pelo HTML servido retorna MIME JavaScript, inclusive nas URLs profundas.
- Inicialização real no Chromium: login release, painel indisponível normal e H1 público nos caminhos reservados, sem pageerrors nem violações CSP espontâneas.
- Login API real, persistência de rascunho sentinela, confirmação de seu conteúdo na API autenticada e remoção dos cookies; leitura subsequente recusada com 401. A sentinela não aparece no HTML nem DOM dos três caminhos ou na homepage.
- APIs site e recibos sem sessão retornam 401/no-store sem documento, objectKey, passwordHash ou csrfToken.
- Script inline não executa e produz violação `script-src-elem`; largura inline legítima permanece 37px; fetch de data URL é recusado por `connect-src`, sem realizar conexão externa.
- URLs acessadas não carregam sessão em query; `/` e `/administrator` não recebem indevidamente a política administrativa.

Nenhum skip, fixme, retry, relaxamento de asserções ou timeout foi adicionado. Durante a autoria, typecheck apontou ambiguidades de tipos DOM/Workers e uma execução identificou fixture não declarada no teste novo. Esses problemas locais foram corrigidos; as asserções de segurança foram mantidas. A versão final passou antes dos gates completos (`adversarial-e2e.log`). A evidência vermelha relevante do produto é a execução inicial, anterior à configuração dos headers.

## Isolamento e preservação comercial

`src/app/App.tsx` mantém o gate literal ADMIN_ENABLED. O normal contém somente AdminDisabled, sem AdminApp, gateway administrativo funcional, mocks ou fixtures; release usa HTTP real. Os verificadores auditam texto, grafo de módulos e manifest. Nenhum contrato CMS ou projeção pública foi importado pela homepage. `requireAdmin` permanece nos handlers CMS; validadores/repositório/SQL continuam bloqueando publicação.

Todos os arquivos rastreados de `src/`, `functions/`, `server/`, `shared/` e `migrations/0001–0009` conservam os hashes do pré-voo. As únicas mudanças rastreadas desta rodada são os três arquivos de build/harness/teste do manifesto. Os E2E públicos incluem caracterização P0 em 390px/1440px, catálogo, volumes fracionários, variantes e WhatsApp. Não há alteração visual intencional no Conceito C.

## Gates finais

| Gate / comando | Exit code | Duração (s) | Resultado |
| --- | --- | --- | --- |
| `npm.cmd run typecheck` | 0 | 1.16 | Aprovado |
| `npm.cmd run lint` | 0 | 0.66 | Aprovado |
| `npm.cmd test -- --maxWorkers=1` | 0 | 734.92 | 1148/1148; 81 arquivos |
| `npm.cmd run build` | 0 | 2.59 | Aprovado |
| `npm.cmd run verify:dist` | 0 | 1.16 | Aprovado |
| `npm.cmd run build:release` | 0 | 3.44 | Aprovado |
| `npm.cmd run verify:release` | 0 | 0.66 | Aprovado |
| `node C:\Users\zzzzz\AppData\Local\Temp\chopp-f4a4-a-p2\public-runner.mjs` | 0 | 27.03 | 61/61 |
| `npm.cmd run test:e2e:real` | 0 | 264.52 | 23/23 |
| `npm.cmd run test:e2e:release` | 0 | 255.34 | 23/23 |

`git diff --check` e lint global final confirmados separadamente no fechamento.

Biome retornou exit code 0, com 46 warnings e 16 infos em código legado preservado; não foram corrigidos nem ocultados fora do escopo. Nenhum diagnóstico aponta os arquivos alterados pelo P2.

Logs completos e JSON: `%TEMP%/chopp-f4a4-a-p2/`. E2E público, administrativo e release executados sequencialmente; Vitest com `--maxWorkers=1`. O runner público usa build production e o runtime descartável real; cobre os arquivos públicos/API e a caracterização CMS. Não executa os testes antigos de painel mockado como se fossem release. A configuração Playwright legada que persiste em `.wrangler/e2e-state` não foi utilizada. Somente migrations 0001–0009 aprovadas foram aplicadas automaticamente pelos harnesses a bancos temporários com UUID e marcador de posse; nenhum banco mantido, binding remoto ou credencial do operador foi usado. Nenhuma migration foi criada ou modificada.

## Graphify e limites

Skill Graphify lida e aplicada antes de qualquer alteração. Grafo existente: 1552 nós. Consulta BFS sobre headers/App/gates/autenticação/bundles, explain de App e do runtime. Logs: `graph-before-query.log`, `graph-before-app.log`, `graph-before-runtime.log`. A consulta ampla encontrou 640 candidatos e exibiu 139 pelo orçamento; ela não foi tratada como prova exaustiva. App tem arestas para LandingPage/AdminApp/AdminDisabled; runtime conecta o servidor E2E, bootstrap, isolamento de ambiente, Vite e Miniflare. Código e SDK foram inspecionados diretamente para confirmar os acoplamentos e a diferença Pages/Workers.

Nenhuma regeneração ou configuração/hook do Graphify alterado. Dos 45 arquivos inicialmente inventariados, somente `graphify-out/cache/last_query_stamp` mudou por operação da consulta; os outros 44 permanecem idênticos. A nova dependência Node runtime→SDK Wrangler foi conferida diretamente. Sem novo caminho de imports frontend→servidor; `_headers`, CSP e regras HTTP não são demonstráveis por arestas TS do grafo. Não se afirma extração estrutural nova nem validação remota a partir do grafo existente.

## Git, hashes e manifesto

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
 M scripts/dev-admin-integration.mts
 M tests/e2e-real/admin-real.spec.ts
 M vite.config.ts
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-f4a4-a-p2.md
?? docs/immersive-cms-stage4-spec.md
?? public/_headers
```

Manifesto exclusivo de cinco arquivos e hashes: `%TEMP%/chopp-f4a4-a-p2/delivery-files.txt` e `delivery-hashes.json`. Índice vazio; HEAD e branch preservados. Correção CP0, especificação e configurações externas ficam fora da entrega. Registro SHA-256 das seis proteções: `protected-final-hashes.json`; comparação completa de arquivos rastreados, migrations e grafo: `preservation-final.json`. Estes registros temporários não fazem parte do manifesto.

| Proteção | SHA-256 preservado |
| --- | --- |
| `.gitignore` | `8e50a25a8e259b2912835c6a77a1b03dfd0558e24315c1d1470a5972af587668` |
| `.claude/settings.json` | `f4e5f81ee806e3792a2c9c57285c1ce009be083019f42ac8e435bd4790ab8b2a` |
| `.claude/settings.local.json` | `21dcff94caa79881e580b87945186af2bd9c54ada5665497196b9bd835f9f816` |
| `CLAUDE.md` | `55189e0bb8f83d9de53de3142fc8702c6ec45d01df3478da4b8224cb0d20d83c` |
| `docs/immersive-cms-stage4-spec.md` | `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873` |
| `e2e/catalog-atomic-routes.spec.ts` | `0abbe95a5ac242093f8f4227aa321577a7a2ddd6b9c18157a78aaae1b64c5985` |


## Riscos residuais e veredito

**GO para auditoria independente do P2.** Gates aprovados, headers comprovados no CLI Pages local e no navegador, sem bloqueador confirmado no escopo. O GO não autoriza P3, publicação, staging ou produção.

Limites: equivalência local não prova comportamento no Cloudflare remoto; validar futuramente em ambiente isolado autorizado. CSP é da fundação atual, não contrato imutável para iframe/mídia futura. API de assets Wrangler unstable demanda revalidação após upgrade. A base absoluta pressupõe o deployment Pages na raiz já configurado; hospedagem futura em subdiretório exige revisão explícita. Exaustão de portas locais continua risco do ambiente de testes, sem alteração de timeouts. Headers não revogam cópias eventualmente armazenadas por clientes antes desta configuração.

Nenhum commit, push, merge, rebase, PR, staging, deploy, publicação, editor visual ou P3 iniciado.

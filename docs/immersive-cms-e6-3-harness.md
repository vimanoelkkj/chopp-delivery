# E6.3 — diagnóstico do harness Pages/D1

Baseline: `integration/immersive-cms-f4a`, HEAD `29ec349aa0ca727581105d5c7699b61ded9e91bc`.

## Veredito e limite da conclusão

**GO técnico para execução/homologação local dos cenários verificados.** O harness existente executou os 12 E2E reais direcionados sem alteração de código ou dependências. **A causa do 404 histórico permanece inconclusiva; não se declara uma correção causal desse incidente.** Para reproduzi-lo e encerrar seu diagnóstico são necessários o comando exato, log bruto e ambiente da execução original. A solicitação desses dados foi enviada durante a investigação.

Não há patch comprovado a aplicar ao harness. Não foram introduzidos intermediário de proxy, acesso alternativo ao SQLite, retries, sleeps de prontidão ou mudanças em asserções. Um teste verde atual não exclui uma falha intermitente histórica.

## Caminho efetivamente inspecionado

`playwright.real.config.ts` → fixture `integration` de `tests/e2e-real/admin-real.spec.ts` → `fork` de `tests/e2e-real/server.mts` com `execArgv: []` e ambiente allowlist → `startIntegration` de `scripts/dev-admin-integration.mts` → build Vite em diretório temporário próprio → build Pages Functions → migrations Wrangler **--local**, config e persistência exclusivos → binding Pages ASSETS real → Miniflare → `await runtime.ready` → `getD1Database('DELEGAS_DB')` → `bootstrapOwner` → comunicação IPC de readiness → navegador e APIs → fechamento SQLite, dispose workerd e exclusão do diretório com marcador de propriedade.

O runtime já aguarda readiness. O primeiro worker se chama `pages-local` e contém o binding D1. O método instalado `#getProxy` resolve o primeiro worker quando o nome é omitido; omitir o segundo argumento não demonstrou erro.

Magic Proxy: no Miniflare instalado, `ProxyClient` usa `/cdn-cgi/platform-proxy`; o worker interno `core/entry.worker.js` intercepta esse pathname **antes** de selecionar o serviço da aplicação. Sem MF-Op, retorna 400 `Invalid proxy request`. Com RPC, encaminha ao proxy interno, que valida Host, segredo e operação. A resposta 404 também existe para operação RPC desconhecida; seu status sozinho não determina que ASSETS respondeu.

O relatório independente `audit-stage4-e6-3-report.md`, seção 6, atribui o 404 ao fallback de assets, mas não contém comando exato, captura HTTP ou log completo que comprove essa atribuição. O código instalado e o controle mínimo contradizem essa explicação determinística. Não foi possível identificar a origem do 404 relatado a partir da síntese disponível.

## Ambiente comparado

- Node v24.22.1; Miniflare direto 4.20260730.0, workerd 1.20260730.1.
- Wrangler 4.151.0 tem Miniflare transitivo 5.20261012.0-beta e workerd 1.20261012.1. Essa coexistência está instalada, sem mudança de package.json/lock; não demonstrou causalidade.
- A execução anterior E6.2 está preservada em `%TEMP%/chopp-admin-e62-ca65e1d/e2e-real-editor.log`: cinco cenários E6.1 passaram em 44,4 s usando a mesma separação por processo Node.
- Execução atual usa porta 4260 e Chromium headless já instalado em `chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe`. Não houve download/instalação.
- O primeiro comando de diagnóstico apontava por engano para `chrome-win/headless_shell.exe`: o servidor terminou sua inicialização, mas o navegador não existia naquele caminho. Corrigido apenas o argumento do experimento, sem alterar configuração do projeto. Esse erro não era o 404 relatado.
- Um experimento inicial via Node stdin/`--input-type=module` parou após ready e foi interrompido; não é o modo do harness, que usa arquivo Node separado. Não foi classificado como reprodução do 404.

## Reprodução mínima e controles

Script independente em `%TEMP%/chopp-admin-e63-29ec349/minimal.mjs`, executado com `node <caminho>`. Usa Miniflare direto instalado, host 127.0.0.1, porta efêmera, um worker nomeado `pages-local`, banco UUID com `d1Persist:false` e fallback de aplicação 404 explicitamente identificável.

Dois ciclos completos passaram (exit 0):
1. ready;
2. GET sem RPC em `/cdn-cgi/platform-proxy`: **400 Invalid proxy request**, não o corpo `APPLICATION FALLBACK`;
3. getD1Database, CREATE/INSERT transacional por batch, SELECT: `{n:42}`;
4. GET `/db` pela aplicação retorna o mesmo `{n:42}`;
5. dispose concluído.

Isso comprova o acesso Node↔Magic Proxy↔D1 e aplicação↔D1 nos dois ciclos; não reproduz a falha histórica nem prova ausência de toda condição de corrida.

## Validações direcionadas

| Comando/escopo | Resultado |
| --- | --- |
| E2E real `--grep 'E6.0: iniciar'` com Chromium correto | 1/1, exit 0 (10,6 s) |
| E2E real `--grep 'E6.0:|E6.1:|CP3: Pages|P4: server-authenticated' --grep-invert 'E6.0: iniciar'` | 11/11, exit 0 (1,7 min) |
| Vitest `tests/backend/cms-v2-publication-block.test.ts --maxWorkers=1` | 1/1, exit 0 |
| Typecheck | exit 0 |
| Biome nos três arquivos harness/fixture/servidor | exit 0, sem escrita |
| Build normal | exit 0 |
| verify:dist após build normal | exit 0 |
| verify:release | exit 0, bundle existente |
| git diff --check | exit 0 |

Os 12 casos reais cobrem: leitura de v1/nenhum documento sem escrita automática; inicialização e conversão explícitas/idempotentes; conflito de revisão; sessão expirada; edição de textos/listas/visibilidade; persistência; prévia mostrando só salvo; validação de limites; recibos v1/v2 imutáveis após edição; resposta perdida sem segundo PUT; shell/frame anônimos e tokens em URL recusados. O controle SQL adicional rejeita promoção a published e mutação/exclusão de históricos/referências. Não foi alterado nenhum teste.

O primeiro verify:dist retornou 1 porque o diretório ignorado `dist` continha AdminApp e literais de mock/salvamento. Um build normal recompôs esse artefato local e o verificador passou. Não se atribui esse artefato ao incidente do proxy nem se identifica seu produtor sem evidência. Não foi relaxado o verificador. Os E2E constroem seus próprios bundles temporários, independentes desse dist.

Não foram repetidas suítes completas. Os runtimes reais executaram sequencialmente; todas as migrations usadas pertencem a 0001–0009 e foram aplicadas somente nos bancos descartáveis próprios dos harnesses. Nenhum banco mantido/remoto foi acessado.

## Preservação e entrega

Único arquivo novo da entrega: este relatório. Nenhuma alteração em scripts, testes, dependências, backend, contratos, migrations, homepage ou configurações. Os hashes dos 447 arquivos existentes capturados em `before.json` foram comparados e permaneceram idênticos. Isso inclui a correção CP0, .gitignore, CLAUDE.md, configuração local/compartilhada do Claude e a especificação CMS v2. Os arquivos do Graphify permaneceram iguais desde o snapshot posterior à consulta inicial; nenhuma atualização de grafo/configuração foi executada. Índice vazio e HEAD mantido.

Graphify consultado antes da inspeção: BFS de integração/admin retornou 322 candidatos, 39 exibidos com orçamento 1200; o truncamento limita a cobertura do grafo. Confirmação direta em scripts, fixture e código instalado de Miniflare foi a evidência do ciclo de vida; o grafo não prova comportamento HTTP. A consulta inicial pode atualizar apenas seu timestamp operacional, mantido fora da entrega.

Logs e evidências automáticas: `%TEMP%/chopp-admin-e63-29ec349/` (`minimal.log`, `baseline-real.log`, `baseline-real-browser.log`, `real-final.log`, `before.json`, `verification.json`, `delivery-manifest.json`). Nenhum dado de sessão ou senha é transcrito neste relatório. O relatório independente permanece inalterado.

## Riscos residuais

Incidente original sem log bruto/comando/ambiente reproduzível; possível intermitência não excluída. A validação foi local Windows/Chromium e não autoriza Cloudflare remoto, publicação ou produção. Não há fundamento para apresentar uma correção de sincronização não demonstrada. Sem commit, staging Git, push, merge, rebase, deploy ou publicação. Parar para avaliação.

# E6.2 — auditoria e estabilização do editor textual CMS

**GO para consolidação local de E6.1 + E6.2**, dentro deste escopo. Sem commit, staging Git, push, merge, rebase, deploy ou publicação nesta rodada. Não autoriza homologação remota ou publicação CMS.

Baseline: `integration/immersive-cms-f4a`, HEAD `ca65e1dc6787f4fa0105a4dd6967f298aacf4c7e`. Estado e conteúdo dos 15 arquivos E6.1 foram registrados antes das correções em `%TEMP%/chopp-admin-e62-ca65e1d/e61-source/`; hashes de todo o workspace em `before.json`. As correções se limitam aos oito arquivos sobrepostos indicados abaixo, a um teste backend novo e a este relatório. Nenhum CSS foi alterado pela E6.2.

## Caminho completo de salvamento

`HomeEditor.tsx:538` (ação explícita Salvar) → `useCommandRun.ts:70` (exclusão mútua, identidade do comando e callbacks) → `cmsCommands.ts` (`runCommand`/`post`, PUT JSON em `/api/admin/site/draft`, credentials same-origin, cache no-store, If-Match entre aspas) → `functions/api/admin/site/draft.ts` → `server/cms/handlers.ts:68` (`requireAdmin`, `mutationInput`, validação estrita, revisão do corpo igual a If-Match) → `server/cms/repository.ts:376` (`save` despacha v2) → `saveV2:295` (hash canônico, procura replay, confere revisão e repete lookup para corrida) → `execute:245` (`db.batch`) → `migrations/0009_cms_v2.sql:152` (`cms_v2_write_command`).

O trigger confere prontidão, sessão, origem, revisão, identidade/payload do comando e referências; insere versão, referências e estado no mesmo statement, verifica pós-condições e aborta divergências. operation_id é único e versões/referências são imutáveis. O batch inclui prova de autorização e leitura da versão resultante. If-Match ausente recebe 428; corpo incompatível é recusado antes da escrita; revisão concorrente recebe 409.

Recuperação: `GET /api/admin/site/commands/:id` → `handleCmsCommand` → `repository.command/lookup` → recibo montado a partir da versão histórica do ator autenticado, não do estado atual. O cliente mantém operationId e payload para repetição manual da mesma operação. Não há reenvio automático. Um 404 **não** prova que um PUT em voo foi abortado: permanece inconclusivo. Repetição manual pode ocorrer, mas usa o MESMO comando idempotente; edição e atualização do documento ficam bloqueadas até resolver o resultado.

O binding atual usa D1 diretamente, sem Sessions API; a documentação informa leitura no primário nesse modo. Batch é transacional. Referências oficiais: [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/) e [replicação/leitura](https://developers.cloudflare.com/d1/best-practices/read-replication/). Não se inferiu uma garantia de ausência futura a partir de leitura negativa.

## Defeitos comprovados e correções

| Achado | Evidência anterior | Correção e controle posterior |
| --- | --- | --- |
| Atualização durante operação | Atualizar permanecia habilitado com PUT pendente; podia desmontar o editor e perder a identidade da operação antes da resposta | HomeEditor comunica seu bloqueio a SiteView; botão e função de atualizar bloqueados em submissão/reconciliação/resultado incerto. Testes com PUT retido e 404 seguido de recibo tardio, sem outro PUT. |
| Recuperação com revisão divergente | Depois de expirar, uma revisão diferente descartava automaticamente a cópia local | Mesma conta mantém a cópia em conflito, com salvamento bloqueado; o servidor não é sobrescrito. Só descarte/carregamento explicitamente confirmados removem o local; não há merge. |
| Interferência entre telas na expiração | Expirar em Produtos apagava o texto CMS ainda não salvo | Buffer já existente de recuperação foi estendido às alterações atuais, apenas em RAM. Expiração em qualquer tela preserva ambos os domínios. Logout voluntário confirmado limpa os buffers. |
| Resposta tardia da tela antiga | Um 401 entregue depois de logout/novo login encerrava a sessão nova e removia sua edição | useCommandRun ignora resultados depois de desmontar. Teste retém o PUT da sessão antiga e entrega 401 depois de editar na nova sessão. |
| Commit ocorrido antes da expiração | Depois de novo login, um texto já persistido era apresentado como conflito/não salvo | Comparação com o documento recém-lido reconhece conteúdo já salvo, não reaplica nem reenvia. Testes frontend e D1 após revogação posterior ao commit. |
| Proteção incompleta no modelo | setField aceitava media.id/media.alt e entries.0.itemId/entries.0.media, apesar da UI não expor inputs desses campos | Allowlist de caminhos editoriais por template no modelo puro; rejeita mídia, IDs/referências e outros caminhos aninhados. Teste unitário vermelho antes, verde depois. Não se afirma que havia uma rota pública explorável: era uma lacuna interna do modelo. |

Controles anteriores: `red-primary.json`, `red-late-session.json`, falhas unitárias observadas no terminal. O primeiro teste adversarial de mídia precisou corrigir a fixture vazia; a falha efetiva posterior demonstrou alteração de media.id. Nenhuma asserção legítima foi reduzida. O teste E6.1 que antes esperava descarte após revisão divergente foi fortalecido: exige preservar local, bloquear salvar e manter o novo documento do servidor intacto.

## Matriz das dez verificações

| Item | Resultado/evidência |
| --- | --- |
| 1. Caminho PUT | Mapeado acima, confrontado com handlers, validação e trigger SQL; sem alterações nessas camadas. |
| 2. If-Match/operationId/recibo | Duas sessões F2 com cookies diferentes no mesmo D1: mesma revisão, exatamente um 200 e um 409; payloads locais intactos; replay por outra sessão da mesma conta retorna recibo original; colisão de payload recusada. |
| 3. Resposta perdida | E2E real deixa Pages gravar via route.fetch e derruba só a resposta. Um único PUT, consulta de recibo e UI reconhece o salvo. |
| 4. Respostas tardias/404 | PUT retido bloqueia Atualizar; 404 mantém texto/edição travada; recibo posterior reconcilia sem novo PUT; callback antigo não afeta login novo. |
| 5. Conflitos | Texto local preservado, sem sobrescrever o vencedor; carregar estado remoto exige descarte confirmado. Recuperação divergente tem a mesma proteção. |
| 6. Sessão antes/durante/depois | Antes: 401 sem versão. Durante: trigger de teste revoga sessões no UPDATE; transação aborta e reverte versão/estado/revogação. Depois: versão/recibo permanecem; login novo lê e reexecuta idempotentemente, sem segunda versão. |
| 7. Produtos independente | Salvar Produtos mantém texto CMS pendente e não faz PUT CMS; salvar CMS mantém preço 515,00 e não muda catálogo D1. Expiração bidirecional preserva os dois rascunhos. |
| 8. Campos protegidos | UI somente leitura para comercial/IDs/mídia; modelo recusa caminhos aninhados; tipos/referências comerciais mantidos no payload. SQL existente continua bloqueando publicação e protegendo mídia histórica/referências. |
| 9. Prévia só do salvo | E2E real compara GET/iframe antes/depois do salvamento: texto local não aparece, salvo aparece após atualizar a prévia. Não existe canal de documento local para o frame. |
| 10. Recarregar/fechar | beforeunload nativo confirmado com alterações pendentes; cancelar recarga e fechamento mantém texto. localStorage/sessionStorage permanecem vazios. Confirmar saída ou encerramento abrupto perde memória não salva, por desenho. |

## Testes e gates

- 91 unitários frontend (editModel, cmsCommands, siteModel, initialDocument), quatro arquivos, maxWorkers=1: aprovados.
- Cinco testes backend selecionados, três arquivos: três novos de sessão/concorrência/recibos, um de publicação SQL e um de proteção de mídia/itens; D1/R2 persist=false, descartáveis. Quatro outros casos dos arquivos não foram executados pelo filtro, sem desabilitar testes.
- 40 cenários locais do editor aprovados: 38 na rodada principal; um teste novo de cancelamento de recarga tinha espera indevida por um load cancelado, foi corrigido e reexecutado isoladamente; um cenário adicional de salvar os dois domínios foi executado isoladamente. Sem alteração de produção entre essas execuções. Não há retries.
- Cinco E2E E6.1 com Pages HTTP e D1 reais descartáveis: aprovados (44,4 s), incluindo persistência/prévia, listas, conflito, sessão e resposta perdida.
- Typecheck, Biome dos arquivos envolvidos, build normal, verify:dist, build release/verify:release e git diff --check: aprovados. Depois da última adição de teste, foi removida somente uma linha em branco excedente, seguido de Biome/typecheck aprovados. Builds não foram repetidos por essa alteração de teste.

Comandos, exit codes e durações estão em `%TEMP%/chopp-admin-e62-ca65e1d/gates.json` e `.log`. O exit 1 da primeira rodada local está preservado: 38 aprovados e a falha do novo harness de navegação cancelada. `full-editor-first.json`, `native-beforeunload-final.json` e `e2e.json` distinguem a rodada e as resoluções direcionadas. Nenhuma suíte completa Vitest/público/admin/release foi repetida.

## Arquivos e preservação

E6.2 altera: `AdminApp.tsx`, `AdminShell.tsx`, `site/HomeEditor.tsx`, `site/SiteView.tsx`, `site/useCommandRun.ts`, `site/editModel.ts`, `site/editModel.test.ts`, `e2e/admin-site-edit.spec.ts`. Acrescenta `tests/backend/cms-editor-recovery.test.ts` e este relatório. Não descarta os demais arquivos E6.1.

Manifestos automáticos no diretório temporário: `e62-files.json` (dez arquivos desta auditoria) e `combined-delivery.json` (17 arquivos E6.1+E6.2), com SHA-256; `preservation-final.json` comprova proteção. Os hashes não são transcritos manualmente. Backend, contratos shared, migrations 0001–0009, homepage e todos os CSS do snapshot E6.1 são idênticos ao início.

Protegidos e fora da entrega: `.gitignore`, `e2e/catalog-atomic-routes.spec.ts`, `.claude/settings.json`, `.claude/settings.local.json`, `CLAUDE.md`, `docs/immersive-cms-stage4-spec.md`. Índice vazio; HEAD/branch mantidos. Graphify: consulta BFS (1887 nós, 413 candidatos, 31 exibidos com orçamento 1000), acompanhada de inspeção direta; truncamento não é prova exaustiva. Grafo não regenerado, configurações/hooks intactos, somente last_query_stamp operacional mudou.

## Riscos residuais e checkpoint

Conflitos não são mesclados. Uma cópia local incompatível fica disponível para consulta/cópia até descarte explícito, sem permissão de sobrescrever o servidor. 404 e falhas de transporte continuam inconclusivos; eventual repetição manual usa a mesma identidade/payload e o SQL idempotente.

Não há autosave nem persistência local. A recuperação existe apenas na memória desta página e é restrita à mesma conta. Ao confirmar saída/recarga ou encerrar navegador/processo, alterações não salvas podem ser perdidas; beforeunload é melhor esforço e depende do navegador. A validação nativa realizada foi Chromium/Windows; Safari/iOS e Cloudflare remoto não foram homologados. Publicação continua bloqueada e o site público não consome o documento CMS. Parar para avaliação; nenhum commit criado.

# F3A.2 — acompanhamento da implementação local

Implementação LOCAL autorizada explicitamente em 14/10/2026, por texto anexado pelo
usuário. Branch/base conferidas. PoCs históricos 33/33; regressões definitivas abaixo.
Arquitetura: [plan.md](plan.md). Contrato vigente: [catalog-expansion.md](../docs/catalog-expansion.md).
Não há autorização de commit, deploy ou integração F3B.

## T0 — Consolidar decisão e obter autorização para implementar

- [x] Direção aprovada: modelo unificado, creationRef, revisão, centavos, APIs v2 e escopo.
- [x] Comparar A/B com PoCs e recomendar A: 0005 única, janela sem escritores, sem espelho/0006.
- [x] Registrar variantes completas, clientIds preservados, no-op/revisão opaca e aposentadoria v1.
- [x] Receber autorização explícita para iniciar implementação; não inferir da aprovação da direção.
- [x] Validar orçamento local de corpo/itens/variantes após testes, sem extrapolar para capacidade remota.

Dependências: nenhuma. Verificação: esta entrega e autorização de implementação registrada.
Arquivos: tasks/plan.md e tasks/todo.md. Escopo: pequeno.

## T1 — Provar semântica SQL no D1 local descartável

- [x] Demonstrar comando único para criação/edição, falha após INSERT e rollback.
- [x] Demonstrar caso negativo: guarda sem erro/zero linhas deixa DML posterior confirmar.
- [x] Provar guarda com abort inicial/final, expiração entre statements e pós-condições SQL.
- [x] Provar 0005 única, histórico/reaplicação, quatro pontos de falha, EXCEPT,
      origem incompatível, bloqueio legado e restauração de schema parcial.
- [x] Após autorização, transformar as provas relevantes em regressões mantidas da
      implementação final; protótipos temporários não são migrations/handlers prontos.

PoCs já autorizados separadamente, executados fora do repositório. Produção depende de T0.
Arquivos prováveis futuros: tests/backend/catalog-expansion-transaction.test.ts
e testes/fixture dedicados. Escopo: pequeno.
Verificação dos PoCs: relatórios da seção 9 do plano. Futuro: Vitest direcionado em D1 descartável.

## T2 — Candidata 0005 única: schema, backfill e corte coordenado

- [x] Implementar candidata única com tabelas/cópia/EXCEPT, revisão, retirada do comando
      antigo e congelamento I/U/D legado. Não criar espelho nem migration 0006 de corte.
- [x] Provar preservação de catálogo editado/N no backfill, avanço no corte, reaplicação
      e rollback de DDL/dados/histórico; rejeitar origem incompatível sem corrigir dados.
- [x] Definir janela sem escritores, backup consistente e recuperação fechada de parcial.

Dependências: T1. Arquivos prováveis: migrations/0005_catalog_expansion.sql,
tests/backend/catalog-expansion-migration.test.ts, tests/backend/catalog-expansion-fixture.ts,
tests/backend/auth-migrations.test.ts. Escopo: médio.
Verificação: Wrangler --local em bancos novos descartáveis, FK e comparação bidirecional.
A candidata será finalizada em T5 e só depois aplicada ao banco local do projeto;
não editar migrations já aplicadas em um ambiente mantido como válido.

## Checkpoint A — Dados preservados

- [x] Migrations 0001–0004 intactas; escritores antigos bloqueados nos bancos de corte experimentais.
- [x] Banco do projeto ainda não migrado; nenhum writer novo habilitado ou parcial tratado como pronto.
- [x] Regressões atuais passam com a nova migration; revisão técnica dos resultados.

## T3 — Leitores públicos v2 e compatibilidade legada

- [x] Expor categorias/itens/variantes visíveis sem omitir cachaças ou preços null.
- [x] Definir projeção legada completa ou erro explícito quando não representável.
- [x] Provar GET sem escrita, consistência de snapshot e falha fechada de schema/D1.

Dependências: T2. Arquivos prováveis: functions/api/catalog.ts,
server/catalog-expansion/read.ts, server/catalog-expansion/contracts.ts,
functions/api/products.ts, tests/backend/catalog-expansion-public.test.ts. Escopo: médio.
Verificação: Vitest com D1, comparação dos nove itens atuais e cenários de múltiplas garrafas.

## T4 — Leitura administrativa e validação de entrada

- [x] Criar GET administrativo v2 autenticado e tipos distintos para leitura/escrita.
- [x] Validar identidades temporárias/persistentes, completude de itens/variantes,
      JSON, Unicode, volumes, centavos e item novo sem variantes/preço válido.
- [x] Provar acesso/CSRF/métodos e orçamento de corpo/quantidade antes de gerar SQL.

Dependências: T3. Arquivos prováveis: functions/api/admin/catalog/v2.ts,
server/catalog-expansion/admin.ts, server/catalog-expansion/validation.ts,
tests/backend/catalog-expansion-validation.test.ts, tests/backend/catalog-expansion-auth.test.ts.
Escopo: médio. Verificação: testes positivos/negativos; PUT permanece indisponível até o corte.

## T5 — Comando unificado e corte local

- [x] Finalizar na mesma 0005 o comando único protegido por revisão + adminWriteProof,
      gate de schema completo e pós-condições; sem arquivo separado de corte.
- [x] Salvar itens novos/existentes e variantes juntos, com refs persistidas e snapshot final.
- [x] Provar concorrência, no-op e rollback de linhas/refs/revisão em todas as falhas previstas.

Dependências: T4. Arquivos prováveis: migrations/0005_catalog_expansion.sql,
server/catalog-expansion/write.ts, server/catalog-expansion/admin.ts,
tests/backend/catalog-expansion-atomic.test.ts, tests/backend/catalog-expansion-cutover.test.ts.
Escopo: médio. Verificação: D1 descartável, falha na quinta linha, INSERTs/IGNORE/revogação/retry.
Nenhuma aplicação ao banco mantido antes da candidata completa/gates e da janela
sem escritores; migração remota continua proibida. Novos backends/consumidores precisam
estar prontos antes de reabrir a edição.

## T6 — Aposentar todas as escritas legadas antes de deploy

- [x] PATCHs por item e PUT v1 retornam 410 ENDPOINT_RETIRED após autenticação/CSRF;
      nenhum adaptador permite escrever sem precondição. Apenas PUT v2 escreve.
- [x] Manter leituras legadas apenas como projeção completa da fonte nova ou erro explícito.
- [x] Provar que arquivos antigos não recebem novas escritas nem são usados como fallback.

Dependências: T5. Arquivos prováveis: server/admin-catalog/repository.ts,
server/admin-catalog/catalog-repository.ts, server/admin-catalog/handlers.ts,
tests/backend/admin-catalog.test.ts, tests/backend/catalog-atomic.test.ts. Escopo: médio.
Verificação: aposentadoria via HTTP e SQL e casos de compatibilidade/incompatibilidade.
Portar a cobertura positiva de edição para PUT v2; não reduzir os testes antigos a
simples expectativas 410 nem eliminar testes de autorização, dinheiro ou rollback.

## Checkpoint B — Backend apto para revisão

- [ ] Migração e escritores revisados independentemente, sem P0/P1 pendentes.
- [x] Gates backend completos e testes de orçamento; não liberar formatos novos no site antigo.
- [x] Gate bloqueante: nenhum writer v1 pode funcionar, inclusive com sessão/origem válidas.
- [x] Preservar legado congelado; não executar remoção física por conveniência.

## T7 — Migrar consumidor público antes da expansão comercial

- [x] Alterar parser/tipos para v2 e adaptar os consumidores de cachaça singular.
- [x] Renderizar todo o DTO de itens/variantes, com preços corretos e mesmos estados de falha;
      não descartar campos/categorias desconhecidos silenciosamente.
- [x] Manter apresentação atual dos nove itens e provar múltiplas cachaças sem omissão.

Dependências: T3; liberação depende do Checkpoint B. Arquivos prováveis:
src/features/catalog/api.ts, src/features/catalog/types.ts,
src/pages/landing/LandingPage.tsx, src/features/catalog/CachacaBanner.tsx,
e2e/catalog-expansion.spec.ts. Escopo: médio, sujeito à autorização da alteração de frontend.
Verificação: testes de contrato e Chrome, catálogo atual e expandido, desktop/mobile.

## T8 — Contrato/gateway e rascunhos F3B

- [ ] Planejar integração de 0808d2e sem alterar o worktree de referência.
- [ ] Generalizar tipos, draft e save para categorias/variantes e novos IDs, com reconciliação por ref.
- [ ] Manter conflito bloqueante e encerramento de sessão; persistir clientIds/revisão
      pendentes em journal da aba, sem credenciais, antes do fetch. Provar reload,
      limpeza no logout e que perda do clientId não dispara retry com refs regeneradas.

Dependências: T6; integração F3B exige autorização e branch coordenadas.
Arquivos prováveis no destino de integração: catalog/types.ts, catalog/gateway.ts,
catalog/draft.ts, catalog/draft.test.ts e testes do gateway. Escopo: médio.
Verificação: unidade/contrato, refs novas/retornadas e nenhuma criação duplicada.

## T9 — Formulário de cadastro e variantes

- [ ] Adicionar criação/cancelamento de itens temporários e seus nomes/descrições/variantes.
- [ ] Reutilizar a máscara monetária, com regras de preço/volume e erros por campo.
- [ ] Preservar foco, teclado, comportamento mobile e bloqueio de salvar durante conflito.

Dependências: T8. Arquivos prováveis no destino de integração:
catalog/CreateItemForm.tsx, catalog/ProductRow.tsx, catalog/useCatalogEditor.ts,
catalog/draft.test.ts e e2e/admin-catalog-create.spec.ts. Escopo: médio.
Verificação: Vitest e Chrome; escopo visual/formulário depende de aprovação própria.

## Checkpoint C — Fechamento e liberação local

- [x] Preservar os testes existentes, ampliando cobertura sem reduzir expectativas.
- [x] Executar typecheck frontend/backend, Biome, Vitest, backend D1, Chrome, build,
      npm audit e git diff --check, com suites pesadas separadas.
- [x] Atualizar documentação de execução, transição, limites e recuperação.
- [x] Medir orçamento de corpo/itens/variantes; propostas 128 KiB/128/8/512 não
      constituem capacidades aprovadas, e limites de escrita nunca truncam GET.
- [ ] Revisão independente e autorização antes de qualquer commit/integração/liberação.

Fora deste plano: estoque, pedidos, pagamentos, R2, upload, editor de categorias,
exclusão persistente, recursos remotos ou publicação. Nenhum deploy é autorizado pelo plano.

## Evidências da implementação definitiva — 14–15/10/2026

- Base/HEAD `fbea7640f090aa46b34260bb135a750a58fa0f0a`, branch `feat/catalog-expansion`.
  Sem alterações staged. Sem commit, push, integração F3B ou acesso remoto.
- Typecheck frontend/backend aprovado; Biome completo: 143 arquivos, sem erros.
- Vitest completo final: **417/417**, 29 arquivos; baseline 339 preservada, 78 regressões novas.
  As fixtures históricas mantêm o schema 0004; as novas usam 0005. O teste de
  reaplicação passa a editar a fonte nova, preservando conta/versões/dados.
- API, migration e orçamento: 44 regressões aprovadas na suite final. Wrangler: cinco
  cenários de falha/rollback (DDL, backfill, retirada, revisão, equivalência), com
  restauração da candidata e retry sobre o banco revertido. A reaplicação sem
  migrations pendentes também é testada com o arquivo definitivo na suite completa.
- Orçamento real: **131072 bytes, 128 itens, 512 variantes, máximo oito/item**.
  Última rodada local: SQL 977 ms (criação) / 917 ms (no-op), cerca de 2002 ms
  no total local. Sem elevação de timeouts existentes. Esses números não são SLA
  nem validação de quotas remotas; o relatório temporário é reproduzível pelo teste.
- Revisão interna adversarial encontrou e corrigiu IGNORE do UPDATE de metadados,
  AFTER IGNORE que pula o revisionamento e metadados ausentes (NULL). Regressões
  verificam rollback dos dados/revisão. A projeção legada também rejeita ordens
  incompatíveis. Mantida a preferência do usuário pela revisão atual, sem CLI externa.
- npm audit: zero vulnerabilidades. Typecheck frontend/backend, build e Biome
  completo aprovados. Chrome E2E: **42/42**, mantendo os 39 existentes e acrescentando
  três casos. Logs AUTH_UNAVAILABLE nos testes administrativos E2E são esperados
  no ambiente sem bootstrap/configuração; autorização positiva e revogação são
  testadas nos handlers reais com D1 descartável e sessões reais.
- Gate backend separado final: **375/375**, 23 arquivos. Na retomada, acrescentada regressão de
  schema sem `catalog_state`: RED (200 indevido), correção do gate, GREEN (503).
  Vitest completo e backend repetidos e aprovados após essa correção.
- Chrome DevTools MCP: contexto isolado em localhost:4175, título correto,
  oito linhas de chopes e uma cachaça, GET /api/catalog 200, sem erros/avisos
  no console. Conferência visual em 1280 px e viewport móvel 390 px sem overflow.
  CSS intacto; nenhuma comparação automatizada pixel a pixel foi alegada.
  Formatos adicionais foram testados em Chrome (1280/390) com múltiplas cachaças,
  variante adicional/null e categoria futura. Aba e servidor criados para a
  inspeção foram encerrados; superfícies anteriores ficaram intactas.
- Diff check final e inspeção dos 36 arquivos (15 alterados e 21 novos): sem
  alterações staged, segredos, bancos, temporários ou artefatos na lista de entrega.
  O diff completo para revisão é gerado em test-results/f3a2-review.patch (ignorado).

**Veredito: GO para revisão independente da F3A.2.** Nenhum P0/P1 conhecido após
as correções e os gates. Isso não autoriza commit, integração F3B ou publicação.

### Arquivos da entrega

Criados:

- `migrations/0005_catalog_expansion.sql`, `shared/catalog.ts`.
- `server/catalog-expansion/validation.ts`, `repository.ts`, `handlers.ts`, `legacy.ts`.
- `functions/api/catalog.ts`, `functions/api/admin/catalog/v2.ts`.
- `src/features/catalog/expanded-api.ts`, `expanded-api.test.ts`, `VariantCatalog.tsx`.
- `tests/backend/expansion-fixture.ts`, `expansion-migration.test.ts`,
  `expansion-api.test.ts`, `expansion-budget.test.ts`, `expansion-validation.test.ts`,
  `expansion-wrangler.test.ts`.
- `e2e/catalog-expansion.spec.ts`, `docs/catalog-expansion.md`.
- `tasks/plan.md`, `tasks/todo.md` (planejamento anterior consolidado como documentação).

Alterados:

- `functions/api/products.ts`; `functions/api/admin/catalog.ts`, `products.ts`,
  `products/[id].ts`, `cachacas.ts`, `cachacas/[id].ts`.
- `src/features/catalog/useCatalog.ts`, `CachacaBanner.tsx`;
  `src/pages/landing/sections/CatalogSection.tsx`, `BarrelsSection.tsx`.
- `e2e/catalog-api.spec.ts`, `tests/backend/auth-migrations.test.ts`.
- `README.md`, `docs/admin-catalog-api.md`, `docs/admin-catalog-atomic.md`.

Migrations anteriores, catálogo/seed, dependências, lockfile, CSS, configuração
Playwright e autenticação F2 não foram alterados. Nenhum banco mantido de
desenvolvimento é usado como fixture; o corte é exercitado com escritores parados
nos bancos descartáveis. O estado persistente normal do projeto permanece separado.

### Pendências intencionais

- Revisão independente externa da F3A.2 e aprovação antes de commit.
- Corte de um banco mantido: backup, preflight, parada de escritores e verificação
  do schema/histórico, conforme runbook. Nenhuma execução remota está autorizada.
- Integração F3B e journal de clientIds/rascunhos aguardam autorização própria.
- P2: quotas/runtime/latência Cloudflare e ataques distribuídos não comprovados
  pelos testes locais. Sem rollback comercial sem perda após expansão de dados.

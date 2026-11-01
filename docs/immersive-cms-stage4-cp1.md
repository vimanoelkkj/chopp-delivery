# Etapa 4 / CP1 — contratos CMS v2

Branch: `integration/immersive-cms-f4a`. HEAD preservado: `efe492b753b82e10e0538d0db4107f973bda5eb8`.
Especificação: `docs/immersive-cms-stage4-spec.md`, SHA-256 `154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873`.

## Escopo e transição CP1 → CP3

Implementado somente o CP1 (§4): contratos separados, validação pura, conversão, referências de mídia e projeção não exposta. Nenhuma rota, handler, repositório, migration ou arquivo em `src/` foi alterado. Não há persistência ou publicação v2 nem consumo pela homepage.

Ajuste expressamente autorizado pelo usuário: os DTOs ativos `CmsAdminSnapshot`, `CmsCommandResult`, `CmsMutation` e `CmsDocument` permanecem v1, sem obrigatoriedade de `schema`. Os tipos separados `CmsDocumentV2`, `CmsAdminSnapshotV2`, `CmsVersionedAdminSnapshot`, `CmsVersionedCommandResult` e `CmsAnyDocument` preparam a migração conjunta do repositório/handlers/respostas HTTP no CP3. Não houve alteração dos testes legados para acomodar quebra de contrato.

Decisão de isolamento: `primitives.cmsRevision` aceita `c1_` e `c2_`, usado pelo parser versionado. O reexport legado de `validation.cmsRevision` mantém a regra c1 do runtime HTTP atual; sua adoção versionada fica para a atualização conjunta no CP3. As funções legadas `validateCmsDocument`, `validateCmsMutation` e `projectPublicCms` conservam literalmente as declarações/corpos originais.

`CmsConversionIntent.acknowledge` está reservado apenas no contrato; não existe comando/commit de conversão implementado. A exigência de confirmação para perdas futuras pertence ao CP3. A conversão atual sempre devolve `losses=[]` e aborta com `CMS_CONVERSION_INVALID` se a entrada v1 ou a saída draft não validar.

## Origem e manifesto CP1

| Arquivos | Origem / responsabilidade |
|---|---|
| `shared/cms.ts`, `shared/cms/common.ts`, `shared/cms/v1.ts` | Extração do contrato do HEAD, com reexports compatíveis. |
| `shared/cms/v2.ts` | Contratos novos conforme §4, slots fixos e instituições reordenáveis. |
| `server/admin-catalog/validation.ts`, `server/shared/unicode-policy.ts` | Extração literal das funções Unicode; reexports preservados. `malformedUnicode` foi extraída junto por ser dependência de `unsafeUnicode`. |
| `server/cms/validation.ts`, `server/cms/validation-v1.ts`, `server/cms/primitives.ts` | Separação da validação congelada e primitivas compartilhadas. |
| `server/cms/validation-v2.ts` | Despacho explícito, chaves exatas, limites e projeção allowlisted. |
| `server/cms/convert.ts` | Conversão pura; mapping registra `{from:{id,template},to:{id,template}}` para cada módulo. Não cria IDs nem produtos. |
| `server/cms/media-refs.ts`, `server/cms/media-contract.ts` | Coleta explícita dos dois caminhos, inclusive módulos ocultos; API legada delega; publicação continua bloqueada. |
| `tests/backend/cms-v2-fixture.ts` | Fixtures exclusivamente de teste e adaptadores para a demonstração vermelha no baseline. |
| `tests/backend/cms-v2-contract.test.ts`, `cms-v2-conversion.test.ts`, `cms-media-refs.test.ts` | 45 testes novos de contrato, conversão e proteção de referências. |
| `docs/immersive-cms-stage4-cp1.md` | Este checkpoint. |

São 18 arquivos: quatro modificados e 14 novos. Manifesto de caminhos e hashes finais: `%TEMP%/chopp-stage4/cp1/delivery-files.txt` e `delivery-hashes.json`. A correção CP0 em `e2e/catalog-atomic-routes.spec.ts` e os arquivos externos preexistentes não pertencem ao manifesto CP1.

## TDD e compatibilidade

Antes da implementação: 38 testes, 24 falhas de asserção e 14 sucessos (`red.log`), sem falha por módulo inexistente. Os adaptadores exercitavam as APIs v1 quando as APIs novas ainda não existiam; ausência de suporte v2, conversão identidade e referências não coletadas foram detectadas. Depois da implementação esses 38 passaram; sete testes adicionais ampliaram as provas de limites e metadados, chegando a 45/45 (`green-final.log`). Não se atribui execução vermelha prévia aos sete casos suplementares.

- 720 permutações dos seis blocos institucionais, três highlights identificados separadamente; rejeição de cruzamentos dos slots fixos.
- 500 documentos v1 válidos, gerador determinístico com semente `0xc015face`; validação v1 antes e v2 depois, igualdade de IDs/textos/mídia e ordem relativa institucional, sem mutação da entrada e sem perdas.
- Cobertura desse gerador: 336 com barrels, 164 sem; 186 mídias preenchidas, 150 nulas; 186 barrels ocultos. `barrels.media` e alt são preservados em `carousel.media`; entradas permanecem vazias e produzem aviso.
- Versões desconhecidas e `__proto__`, versões numéricas 2.0/2e0, IDs/cardinalidades, duplicatas, campos comerciais em vários níveis, início sem carrossel visível, URL/HTML/Unicode, getters/toJSON e JSON cíclico.
- Fronteira real de 65.536 bytes UTF-8 aceita; byte seguinte rejeitado. Listas 12/13 e itemId 128/129.
- Referência somente em carousel.media e somente em entries[].media: inventário ausente e derivado adulterado rejeitados; metadados íntegros aceitos. Coleta inclui ocultos, deduplica e ordena.
- Projeção somente de módulos visíveis, âncoras de código, sem visible/region, sem mutação da fonte. Não foi criada rota pública.
- Todos os testes existentes permanecem intactos, inclusive a rejeição de v2 pelo validador legado. A caracterização adicional do despacho está no novo teste, em vez de reescrever o caso legado.

Prova literal das três funções Unicode e das três funções CMS v1: `v1-verbatim-functions.json`. A política de conteúdo e os contratos comerciais permanecem preservados.

## Graphify

Skill consultada em `C:/Users/zzzzz/.claude/skills/graphify/SKILL.md`; consultas de impacto/dependência antes e depois, confirmadas diretamente no código. A consulta inicial identificou o acoplamento CMS → validação do catálogo e consumidores em repositório, handlers, mídia e fixtures, justificando a transição compatível.

`graphify update .`: exit 0, sem instalação ou mudança de configuração/hooks. Grafo atualizado: 1.421 nós, 3.595 arestas; 832 arestas imports_from/re_exports e nenhuma componente fortemente conexa com mais de um nó nesse subgrafo. `primitives.ts` importa a política Unicode compartilhada, sem a antiga dependência de admin-catalog/validation. A comparação do status e dos hashes protegidos antes/depois da atualização foi idêntica. Somente saídas ignoradas de `graphify-out/` foram atualizadas. Extração de código por AST, sem chamada a modelo semântico.

Limites declarados: oito SQLs não extraídos por ausência de `tree_sitter_sql`; 36 arquivos não produziram símbolos; o grafo global é não direcionado, por isso a verificação de ciclos usou as direções source/target das relações de importação/reexportação. O grafo não demonstra integridade SQL ou testes de runtime. Consultas completas, ciclos e logs em `graph-*.log`/`graph-cycles.json`.

## Gates

| Gate | Resultado / exit code | Duração |
|---|---|---|
| Typecheck | APROVADO / 0 | 1.23 s |
| Biome global (32 avisos de any em fixtures/testes adversariais, zero erros) | APROVADO / 0 | 0.67 s |
| Vitest: 1086/1086, 70 arquivos (1041 existentes + 45 novos) | APROVADO / 0 | 266.14 s |
| Build normal | APROVADO / 0 | 2.58 s |
| verify:dist: 5 arquivos, 120 literais, 87 módulos | APROVADO / 0 | 1.12 s |
| Build release (inclui typecheck e verify:release) | APROVADO / 0 | 3.2 s |
| verify:release: 5 arquivos, 135 módulos, 124 literais | APROVADO / 0 | 0.64 s |
| E2E público: 57/57, Pages production em D1 descartável | APROVADO / 0 | 25.7 s |
| E2E administrativo: 20/20, D1 descartável | APROVADO / 0 | 189.22 s |
| E2E release: 20/20, D1 descartável | APROVADO / 0 | 184.42 s |
| git diff --check | APROVADO / 0 | — |

Comandos, exit codes e logs completos: `%TEMP%/chopp-stage4/cp1/gates.json` e arquivos de cada gate. Os E2E foram sequenciais (portas 4212/4213/4214), sem retries adicionados. A suíte pública preservou o isolamento HTTP autorizado no CP0. Todos os testes legados passaram sem alterações. O lint teve exit 0 com 32 avisos, concentrados no JSON deliberadamente malformado dos testes novos; não houve desativação de regra global.

## Preservação e riscos residuais

- HEAD/branch reconferidos e índice vazio confirmado no fechamento. Nenhum commit ou operação remota foi autorizado/executado.
- Hashes de `.gitignore`, `.claude/settings.json`, `.claude/settings.local.json`, `CLAUDE.md`, especificação e correção CP0 preservados contra `protected-hashes.json`.
- Migrations 0001–0008 preservadas byte a byte contra o inventário CP0; migration 0009 ausente. Nenhuma migration ou alteração em banco mantido/remoto foi executada. Os gates usam somente bancos descartáveis existentes nos harnesses.
- A validação pura não consulta existência/estado de itemId no catálogo ou disponibilidade atual no R2. Essas verificações atômicas pertencem aos checkpoints posteriores; a análise de publicação aqui cobre referências e metadados, sem afirmar disponibilidade permanente.
- `carousel.media` permanece referência editorial sem função visual definida. Nenhum renderizador foi criado.
- Persistência/handlers v2, supersessão e confirmação de perdas futuras ainda não implementados, por escopo. Sem publicação, editor ou integração CMS/homepage.
- Pendências históricas permanecem: cota vitalícia de 100 mídias, retenção/GC, IDs de bancos mantidos não inspecionados e futura comprovação D1 da 0009. Não foram tratadas como implementadas neste CP1.

**GO técnico para auditoria independente do CP1.** Nenhum bloqueador confirmado pelos gates. CP2 e CP3 não iniciados; nenhum commit, push, merge, rebase, staging, deploy ou publicação executado.


## Estado final do Git

```text
 M .gitignore
 M e2e/catalog-atomic-routes.spec.ts
 M server/admin-catalog/validation.ts
 M server/cms/media-contract.ts
 M server/cms/validation.ts
 M shared/cms.ts
?? .claude/settings.json
?? CLAUDE.md
?? docs/immersive-cms-stage4-cp1.md
?? docs/immersive-cms-stage4-spec.md
?? server/cms/convert.ts
?? server/cms/media-refs.ts
?? server/cms/primitives.ts
?? server/cms/validation-v1.ts
?? server/cms/validation-v2.ts
?? server/shared/unicode-policy.ts
?? shared/cms/common.ts
?? shared/cms/v1.ts
?? shared/cms/v2.ts
?? tests/backend/cms-media-refs.test.ts
?? tests/backend/cms-v2-contract.test.ts
?? tests/backend/cms-v2-conversion.test.ts
?? tests/backend/cms-v2-fixture.ts
```

Quatro modificados e 14 novos são CP1; os dois modificados externos/CP0 e os três não rastreados externos/especificação permanecem separados. `.claude/settings.local.json` permanece preservado e ignorado pela configuração global do usuário. O índice está vazio.

Hashes protegidos conferidos no fechamento:

```json
{
  ".gitignore": "8e50a25a8e259b2912835c6a77a1b03dfd0558e24315c1d1470a5972af587668",
  ".claude/settings.json": "f4e5f81ee806e3792a2c9c57285c1ce009be083019f42ac8e435bd4790ab8b2a",
  ".claude/settings.local.json": "21dcff94caa79881e580b87945186af2bd9c54ada5665497196b9bd835f9f816",
  "CLAUDE.md": "55189e0bb8f83d9de53de3142fc8702c6ec45d01df3478da4b8224cb0d20d83c",
  "docs/immersive-cms-stage4-spec.md": "154cb825c09ca48d2ad5dc37ba776bcc008756f25e5c2f1cae8773c342e23873",
  "e2e/catalog-atomic-routes.spec.ts": "0abbe95a5ac242093f8f4227aa321577a7a2ddd6b9c18157a78aaae1b64c5985"
}
```

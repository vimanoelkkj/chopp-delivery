# F3C.4 — unificação local do catálogo e painel

## Histórico e limites

- Merge local: `25c382c5e0f20304b99f00ec01341a2cd282eef9`.
- Primeiro pai F3C.2: `00715ea14cbd5352031c998af4efe866b97ceb3f`.
- Segundo pai F3C.3: `bbcee7ae183fd0c57148e4ac17f51b577f298d35`.
- Base comum: `1d98c48185842f389ec8c5f3af7479283d10e154`.
- Merge iniciado com `--no-ff --no-commit`; sete arquivos sem conflito, blobs staged conferidos contra F3C.3 antes do commit exclusivo de merge.
- Implementação F3C.4 permanece sem staging e sem commit. Nenhum push, deploy ou D1 remoto autorizado/executado.

O merge passou em typecheck e 58 testes direcionados antes da implementação.

## Sete achados P2

| Achado | Resolução |
| --- | --- |
| Landing com apresentação legada | LandingPage usa ExpandableCatalogView, com o snapshot real de /api/catalog. |
| Âncoras incompatíveis | Landing conserva chopes e chopes-title; laboratório conserva seus IDs próprios. |
| Leituras duplicadas / fixture acessando rede | Snapshot controlado único em LandingPage, compartilhado com BarrelsSection. Fixtures montam só a apresentação. usePublicCatalog reutiliza o transporte/decoder canônico. Um microtask evita enviar a sondagem descartada do StrictMode. |
| WhatsApp genérico / href falso | WhatsAppButton aceita mensagem contextual e preserva seu aviso quando o número está ausente. Preços nulos não geram CTA. Desktop e mobile usam produto, apresentação, volume e centavos atuais. |
| Códigos locais tratados como colunas globais | Colunas compartilhadas somente se rótulo, volume e ordem coincidirem em todos os itens. Caso contrário, tabela exibe apresentações por item. Códigos opacos permanecem associados ao item. |
| Aviso 18+ e IDs duplicados | Landing desliga o aviso adicional da vitrine; Hero e rodapé continuam com seus avisos originais. |
| Reordenação/transformações de demonstração | Variantes e categorias mantêm a ordem recebida. Nomes comerciais não perdem sufixos. Somente o título legado “Temos cachaça” mantém o alias visual “Cachaça” aprovado na F3C.3; banco e API continuam intactos. |

Sem alteração em autenticação, autorização SQL, contratos compartilhados, handlers, migrations, seeds, package.json ou lockfile.

## Fluxo integrado reproduzível

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e:real
```

A fixture de tests/e2e-real/admin-real.spec.ts usa o runtime próprio documentado em [admin-integration-local.md](admin-integration-local.md). Cada teste recebe novo D1 local, migrations locais 0001–0005, pepper e senha temporários; o diretório é removido após dispose. Não reutiliza banco do operador, .dev.vars ou persistência de outro worktree.

A opção de build `production` foi acrescentada somente à fixture/runtime local, para provar AdminDisabled no artefato normal. O padrão continua `admin-integration`. Variável de modo inválida do servidor de testes é recusada. O número de WhatsApp dos testes positivos é sintético e exclusivo do processo filho; nenhum teste abre conversa nem envia mensagens.

Prova F3C.4 em 1440 e 390 px:

1. Login F2 real e edição de Dronken para 51029 centavos.
2. Ocultação de Brahma preservando registro D1, e criação visível de chope com variantes nesta ordem: 20000 ml / 12345 centavos, 7500 ml / null.
3. Reordenação do chope pela UI, gravação e recarga do painel.
4. Criação de segunda cachaça: 700 ml / 2501 centavos e 500 ml / 1999 centavos, preservando essa ordem.
5. Contexto anônimo compara API pública, revisão opaca, ordenação e variantes com D1; confirma ausência de creationRef e de Brahma.
6. Landing exibe valores, IDs definitivos e códigos opacos; a oferta nula não possui link.
7. Links WhatsApp têm texto decodificado conferido por produto, rótulo, volume e preço. Cachaça com múltiplas variantes exige seleção; a troca altera a mensagem.
8. Uma leitura pública por navegação/recarga, sem IDs ou avisos duplicados e sem overflow.
9. Build production mantém /admin desativado, consulta pública real, preview isolado e aviso correto sem número.

As dez provas F3C.2 anteriores continuam presentes, cobrindo também CSRF, expiração, logout, 409, resposta perdida e reconciliação de IDs.

## Testes legados e integridade visual

Somente asserções obsoletas foram ajustadas:

- e2e/catalog-expansion-preview.spec.ts: vitrine agora permitida; controles DEV e fixtures seguem proibidos.
- e2e/catalog-expansion.spec.ts: seletores/textos da nova apresentação, mantendo variantes extras, categorias futuras, cachaças, null, valores e responsividade.
- catalog-expansion.test.ts: componente público permitido no bundle; isolamento de fixtures mantido. Nomes com “(Demonstração)” agora permanecem literais nos testes de mensagem.
- public-vitrine.test.ts: mesma preservação literal dos nomes.
- e2e/landing.spec.ts: seletor de volume agora exato e restrito ao card da cachaça (CTA também contém o volume); acrescentada conferência de R$ 30. e2e/catalog-api.spec.ts não precisou de alteração lógica. as verificações dos oito produtos, loading, erro/retry, centavos, FAQ, teclado, CTA fixo, movimento e overflow permanecem.

O gate verify:dist foi reforçado com identificadores de laboratório e fixtures públicas. App.tsx e os gates administrativos não foram alterados.

Diferenças intencionais do catálogo: cards móveis e vitrine de múltiplas cachaças da F3C.3 ativados na landing; preços no desktop são ofertas contextuais; apresentações heterogêneas aparecem por produto. Hero, Ticker, Barris, Como funciona, Promoção, Sobre, FAQ, Contato e CTA fixo preservados. A seção explicativa Barris mantém os destaques 30/50 L; outros volumes aparecem no catálogo real.

Inspeção Chrome DevTools em contexto isolado: título correto, oito linhas do seed, todos os blocos presentes, zero IDs duplicados, console sem erros/avisos e overflow zero na viewport emulada de 390 px. Laboratório DEV conferido com API real e fixture explícita; a mudança para fixture não acrescentou leituras. Após proteção da sondagem StrictMode, uma leitura também em DEV.

## Gates e diagnóstico

| Gate final | Resultado |
| --- | --- |
| Typecheck frontend/backend | Aprovado, inclusive no build normal final |
| Biome | 251 arquivos, zero diagnósticos |
| Backend / D1 local | 427/427, 27 arquivos, 123,24 s |
| Vitest completo final | 746/746, 52 arquivos, 136,82 s |
| Playwright Chrome tradicional final | 133/133, 1,9 min |
| Playwright Chrome real completo | 13/13, 1,6 min |
| Build normal | Aprovado; assets administrativos limitados a AdminDisabled |
| verify:dist | Aprovado, cinco arquivos textuais; sem fixture, laboratório ou gateway administrativo |
| npm audit --json | Zero: info, low, moderate, high e critical; 200 dependências no relatório |
| git diff --check | Aprovado |
| git diff --cached --name-only | Vazio |
| Worktrees originais | Codex, AG, Claude e storefront limpos e com HEADs originais |

O Vitest anterior com 743 testes também passou; o fechamento acrescentou três regressões e repetiu a suíte completa. Os 427 testes de backend também estão incluídos no Vitest final. Não somar essas contagens como testes distintos.

Não houve achado do npm audit para classificar por alcance/explorabilidade. O lockfile e as dependências não mudaram. A ausência de achados conhecidos não substitui a revisão das fronteiras de confiança.

A falha do seletor legado foi comprovada, corrigida e passou isoladamente antes do E2E completo final. Não houve falha de infraestrutura ou flutuação pendente nestas execuções finais.

Logs completos locais (TEMP, fora do diff): delegas-f3c4-backend.log, delegas-f3c4-vitest-final.log, delegas-f3c4-e2e-final.log, delegas-f3c4-real.log e delegas-f3c4-build.log. Não versionar logs, pois a instância manual de inspeção imprime credenciais exclusivamente temporárias no seu próprio log.

```powershell
npm run typecheck
npm run lint
npm run test:backend -- --maxWorkers=2
npm test -- --maxWorkers=2
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e:real
$env:PLAYWRIGHT_PORT='4193'
npm run test:e2e -- --workers=2
npm run build
npm run verify:dist
npm audit --json
git diff --check
git diff --cached --name-only
```

A porta de testes deve estar livre; não reutilizar servidor existente. O E2E tradicional gera build mode e2e; por isso o fechamento recompila o build normal antes de verify:dist.

Ocorrências investigadas durante o desenvolvimento:

- As duas primeiras falhas do novo teste integrado eram seletores incorretos: ProductRow não atribui nome acessível ao li; ItemCard usa campo Nome, não heading editável. Seletores corrigidos conforme DOM e testes direcionados repetidos. Sem alteração da autenticação ou aumento de timeout.
- Primeiro E2E tradicional completo: 132/133; seletor legado de volume ficou ambíguo com o novo CTA. Corrigido para busca exata no card, mantendo volume e acrescentando preço; repetição direcionada e completa registrada abaixo.
- A primeira chamada de Biome com arrays PowerShell agrupou caminhos em argumentos inválidos; não processou arquivos. Reexecução com argumentos individuais e formatação restrita aos arquivos alterados.
- A edição via pipe Python exigiu OutputEncoding UTF-8; os textos inseridos afetados foram corrigidos antes da validação. Sem alteração dos dados do catálogo.
- O aviso de npm em stderr pode aparecer no log PowerShell como NativeCommandError. O resultado de cada gate é o exit code nativo e o resumo do runner, não esse invólucro.
- Na F3C.2 já havia sensibilidade do teste máximo de catálogo ao paralelismo padrão. Mantidos dois workers; nenhum timeout, limite ou asserção foi enfraquecido.

## Riscos restantes

Validação local não comprova quotas, latência ou comportamento distribuído na borda Cloudflare. Build admin-integration é local e não deve ser publicado. Painel de produção continua desligado.

Encerramento forçado pode deixar TEMP residual, conforme nota operacional F3C.2; nunca é reutilizado automaticamente. Logs e artefatos desta validação ficam em TEMP ou diretórios ignorados, fora do diff. Não há exclusão automática de diretórios de outras sessões.

npm audit sem achados significa ausência de vulnerabilidades conhecidas no banco consultado, não prova geral de segurança. Sem dependências novas.

## Fechamento e revisão

Servidores próprios de inspeção 4194/4195 encerrados e portas conferidas fechadas. A interrupção da sessão automatizada deixou um diretório TEMP próprio; ele foi identificado pelo log dessa sessão, teve caminho absoluto e marcador conferidos e foi removido após confirmar ausência de processo associado. Não foram removidos diretórios de outras sessões.

A F3C.4 não foi adicionada ao index nem commitada. HEAD continua no merge 25c382c5e0f20304b99f00ec01341a2cd282eef9, com os dois pais originais. Sem Co-authored-by no merge.

**GO para revisão independente da F3C.4.** Nenhum P0/P1 ou regressão funcional/visual conhecida após os gates. Quotas e borda remota continuam fora da prova local. Aguardar autorização para staging/commit.

## Arquivos da F3C.4

Total: 23 arquivos (19 modificados e quatro novos).

```text
docs/catalog-integration-local.md
e2e/catalog-expansion-preview.spec.ts
e2e/catalog-expansion.spec.ts
e2e/landing.spec.ts
scripts/check-public-bundle.mjs
scripts/dev-admin-integration.mts
src/features/catalog-expansion/CachacasShowcase.tsx
src/features/catalog-expansion/ExpandableCatalogView.module.css
src/features/catalog-expansion/ExpandableCatalogView.tsx
src/features/catalog-expansion/ExpandablePriceTable.module.css
src/features/catalog-expansion/ExpandablePriceTable.tsx
src/features/catalog-expansion/catalog-expansion.test.ts
src/features/catalog-expansion/columns.ts
src/features/catalog-expansion/messages.ts
src/features/catalog-expansion/public-vitrine.test.ts
src/features/catalog-expansion/storefront-integration.test.ts
src/features/catalog-expansion/usePublicCatalog.ts
src/features/catalog/useCatalog.ts
src/features/contact/WhatsAppButton.tsx
src/pages/landing/LandingPage.tsx
src/pages/preview/MotionPreviewPage.tsx
tests/e2e-real/admin-real.spec.ts
tests/e2e-real/server.mts
```

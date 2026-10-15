# Painel administrativo (F3B): guia de passagem e integração com a F3A.2

Documento para quem for continuar o painel e ligá-lo ao backend de catálogo expandido.
Estado: o painel funciona inteiro contra um **mock**. Nenhuma chamada real ao catálogo é feita.
O adaptador HTTP existe, está testado com `fetch` falso e **não está ligado**.

> **Contrato provisório.** Tudo que fala da API v2 abaixo vem de `tasks/plan.md` (branch
> `feat/catalog-expansion`, ainda em implementação). Rota, campos e status podem mudar.
> Confira com o código final do Codex antes de ligar (passo 1 de "Como conectar").

## 1. Arquitetura

```
AdminApp ── escolhe o gateway (hoje createMockGateway) e guarda o rascunho de sessão expirada
 └─ AdminShell ── cabeçalho, notificações, useCatalogEditor
     └─ CatalogView ── abas, barra de salvar, modal de conflito
         ├─ ProductRow (tabela: chopes 30/50 L e garrafa de cachaça)
         ├─ ItemCard   (qualquer outro produto: nome, descrição, variantes)
         └─ NewProductDialog (escolha da categoria do produto novo)
```

Camadas, de baixo para cima (cada uma só conhece a de baixo):

| Camada | Arquivos (`src/features/admin/catalog/`) | Responsabilidade |
| --- | --- | --- |
| Contrato | `types.ts`, `gateway.ts` | Tipos do catálogo, `SaveInput`/`SaveResult`, `AdminCatalogGateway`, `AdminApiError` |
| Transporte | `httpGateway.ts`, `wire.ts` (NÃO LIGADOS), `mockGateway.ts`, `mockData.ts` | Implementações do gateway. `wire.ts` valida a resposta em tempo de execução |
| Regras puras | `draft.ts`, `price.ts`, `volume.ts`, `saveFlow.ts` | Rascunho, validação, montagem do pedido, máscara, volume, salvamento e recuperação |
| Estado | `useCatalogEditor.ts` | Reducer + efeitos (carregar, salvar, reconciliar, restaurar) |
| Interface | `CatalogView`, `ItemCard`, `ProductRow`, `PriceField`, `NewProductDialog`, `ui/*` | Só desenha e dispara ações |

`AdminCatalogGateway` é a única fronteira com o backend:

```ts
interface AdminCatalogGateway {
  load(signal?: AbortSignal): Promise<AdminCatalog>   // snapshot completo
  save(input: SaveInput): Promise<SaveResult>          // snapshot completo + ids criados
}
// Erros: AdminApiError.code = 'unauthenticated' | 'conflict' | 'rejected' | 'unavailable'
```

Um teste (`tests/frontend/admin-gateway-boundary.test.ts`) impede que qualquer arquivo além de
`AdminApp.tsx` e `catalog/mockGateway.ts` importe o mock.

## 2. Contrato atual do gateway (o que a UI já usa)

- `AdminCatalog { revision, categories[{ id, name, items[{ id, creationRef, name, description, visible, variants[{ code, creationRef, label, volumeMl, priceCents }] }] }] }`
  na ordem de exibição. `revision` é opaca (a UI só compara e devolve).
- `SaveInput { revision, categories[{ id, items[ItemInput] }] }`: **snapshot completo** da
  ordem e do conteúdo, com a revisão base. Itens existentes vão com `id`, novos com `clientId`
  (`tmp:<uuid>`); variantes existentes com `code`, novas com `clientId`.
- `SaveResult { catalog, created: { items[{ clientId, id }], variants[{ itemId, clientId, code }] } }`.
- Preço: **centavos inteiros** (1 a 9.999.999) ou `null` ("não vende"; obrigatório nas cachaças).
- Volume: **`volumeMl` inteiro** (≥ 1) ou `null`. A UI mostra litros nos chopes (aritmética inteira,
  sem float) e ml nas cachaças.
- `409` = base desatualizada: nada foi gravado, salvar fica bloqueado até recarregar.
- `401` = sessão expirada (ver "Sessão expirada").

## 3. Pontos de adaptação para a API v2

Tudo que muda de nome ou formato se resolve em **dois arquivos**:

1. `wire.ts`: o que o servidor devolve → tipos da UI (`parseSnapshot`, `parseSaveResult`).
2. `httpGateway.ts`: rota (`CATALOG_V2_PATH = '/api/admin/catalog/v2'`), método, cabeçalhos
   (`If-Match: "<revision>"`), corpo e mapa de status (401 → `unauthenticated`, 409 → `conflict`,
   400/403/410/428 → `rejected`, resto → `unavailable`).

Se o servidor mandar a revisão no corpo em vez do `If-Match`, ou mudar o nome de um campo, o
ajuste é feito aqui. A UI, o reducer e o `saveFlow` não conhecem nomes do wire.

Premissas que, se mudarem, afetam a lógica (não só o wire):

- Cada item/variante novo recebe um `creationRef` **imutável** (= o `clientId` enviado) que volta no
  GET. A recuperação de resposta perdida depende disso (`saveFlow.classifyUncertain`).
- Reenviar um pedido já gravado volta 409 (revisão base mudou), nunca cria de novo.
- Variantes já persistidas só têm o preço editável (a UI não envia rótulo/volume delas).

## 4. Fluxo de criação e reconciliação

1. **Rascunho.** "Novo produto" cria um item com `key = clientId` (`tmp:…`), `id = null`, oculto.
   Vários itens/variantes novos convivem no mesmo rascunho junto com edições de existentes.
2. **Descartar um temporário.** `cancel-item` remove só linhas ainda não salvas; nada é enviado.
3. **Salvar** (`saveFlow.performSave`): valida; monta `SaveInput` com a revisão base e a ordem
   atual do rascunho (criar + reordenar no mesmo pedido); envia.
4. **Sucesso.** O hook reconstrói o rascunho a partir do snapshot devolvido. As chaves de
   rascunho são `creationRef ?? id`, então a linha criada **mantém a mesma chave** (sem pulo de
   foco/ordem); `created.items[].clientId → id` está disponível para quem precisar mapear.
5. **Resposta perdida** (`unavailable`, rede, JSON inválido): resultado **incerto**. O hook guarda o
   `SaveInput` e faz um GET (`recoverUncertain`), sem reenviar nada. A decisão
   (`saveFlow.classifyUncertain`) compara o snapshot com o **estado pretendido inteiro**, não com
   a presença de `creationRef`:
   - `satisfies(input, snapshot)`: mesmas categorias, mesma ordem, cada item (por `id`, ou por
     `creationRef` = `clientId` se era novo), cada variante (por `code`/`creationRef`) e todos os
     valores canônicos (nome aparado, descrição, `visible`, `volumeMl`, `priceCents`). Equivale ⇒
     `applied` (inclui PUT idêntico que não mudou a revisão);
   - não equivale e a revisão é a da base ⇒ `not-applied`: nada foi gravado; "Salvar" reenvia o
     **mesmo** pedido (mesmos clientIds, mesma revisão), seguro;
   - não equivale e a revisão avançou ⇒ `conflict`: outra sessão mexeu, ou o PUT gravou e alguém
     alterou antes do GET. O painel **não afirma sucesso** e **não reenvia com a revisão nova**;
   - GET indisponível, 5xx ou fora do contrato (`wire.ts`) ⇒ `unreachable`: continua incerto,
     nada é afirmado, "Salvar" tenta verificar de novo antes de enviar.
   Pedido sem criações **não** é prova por vacuidade: só vale `applied` se o snapshot equivale ao
   pretendido. Presença de `creationRef` sozinha também não: foi o caso corrigido (criar + editar
   existente, com a edição sobrescrita por outra sessão, antes virava `applied`).
6. **Edição depois da tentativa incerta.** Se o GET estava fora do ar e o usuário seguiu editando, ao
   confirmar `applied` o rascunho **não** é jogado fora: `rebaseAfterApplied` reaponta os itens/variantes
   novos para os ids definitivos (por `creationRef`) e mantém as edições novas sobre a revisão nova.
   Sem edições posteriores, o rascunho é reconstruído do snapshot.

Limite conhecido da equivalência: se o servidor **normalizar** texto (espaços, Unicode), o snapshot não
equivale ao enviado e o resultado cai em `conflict` (lado seguro, falso conflito). Se isso ocorrer na
F3A.2, normalize igual no `draft.ts` ao montar o pedido, ou ajuste `satisfies`.

## 5. Estados de erro e como a UI reage

| Situação | Reação |
| --- | --- |
| Falha ao carregar | Tela de erro com "Tentar de novo" |
| Campo inválido | Erro no campo (após editar/sair ou ao tentar salvar); foco no primeiro inválido; nada é enviado |
| 409 | Modal "O catálogo mudou"; salvar bloqueado; rascunho preservado; "Recarregar" descarta por escolha |
| 400/403/410/428 (`rejected`) | "O servidor recusou o salvamento…"; rascunho preservado |
| `unavailable` no PUT | Fluxo de resultado incerto (seção 4) |
| 401 | Ver abaixo |

### Sessão expirada sem perder o rascunho

Se o 401 ocorrer com alterações pendentes, o rascunho vai para uma **ref em memória** no `AdminApp`
(`Rescue { draft, revision, userId }`) e a tela de login avisa que ele fica guardado na aba. Após novo
login o catálogo é recarregado e o rascunho só é restaurado se **a revisão for a mesma E o usuário
for o mesmo** (`canRestore`). Revisão diferente: descartado com aviso ("O catálogo mudou…"). Outro
usuário: descartado com aviso ("…pertenciam a outro usuário…"). Nunca é restaurado em silêncio.

## 6. Testes e comandos de validação

Execute em sequência (a ordem importa só para o Playwright, que reconstrói e usa D1 local):

```
npx tsc -b                                    # tipos (front)
npx biome check .                             # lint/format (LF)
npm test                                      # Vitest (unidade + backend)
npm run build
PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=<porta livre> npx playwright test
npm audit
git diff --check
```

Cobertura relevante:

- `draft.test.ts`, `priceMask.test.ts`, `volume.test.ts`: rascunho, máscara, volume exato.
- `mockGateway.test.ts`: o mock obedece as regras do servidor (revisão, ids, conjuntos, replay).
- `editorReducer.test.ts`: reducer, incluindo `uncertain`/`recovering`/`restore`.
- `saveFlow.test.ts`, bloco "recuperação: casos de borda": existentes sem criações, criar + editar,
  refs já persistidos, outra sessão antes do GET, snapshot incompatível, PUT idêntico, GET
  indisponível/inválido, edição posterior preservada. Os 10 fluxos complexos também estão aí (vários produtos, várias cachaças com variantes, criar +
  reordenar, descartar temporário, reconciliar clientIds, resposta perdida, recuperação por
  `creationRef` sem duplicar, 409, 401, máscara/volume).
- `wire.test.ts`, `httpGateway.test.ts`: validação do wire e do transporte com `fetch` falso.
- `e2e/admin-integration-flows.spec.ts`: resposta perdida, sessão expirada com rascunho, 409 com produto
  novo. Demais specs `e2e/admin-*.spec.ts`: painel, máscara, rolagem, cadastro, refinamentos.

Cenários do mock por URL: `?mock=slow|error|empty|save-error|expired|conflict|lost-response`.
**Só existem no `vite dev` e no build de E2E** (`vite build --mode e2e`, usado pelo
`playwright.config.ts`). No build publicável (`npm run build`) o leitor do `?mock=` nem entra no
bundle: a URL não liga nenhum comportamento de teste (`mockGateway.test.ts` + verificação do `dist`).

## 7. Limitações conhecidas

- O rascunho de sessão expirada vive **só em memória**: recarregar ou fechar a aba o perde. Também os
  `clientId` pendentes se perdem; **não há recuperação automática de criação após recarregar a
  página** (ela exigiria persistir rascunho + clientIds no cliente, ex. `sessionStorage`, o que não foi feito).
- Variantes persistidas não têm rótulo/volume editáveis; não há remoção de item persistido nem de
  categoria nova. Itens só ficam ocultos (`visible`).
- A recuperação por `creationRef` depende de o backend devolver `creationRef` no GET; sem isso, tudo
  que é incerto cai em `conflict`.
- A recuperação por equivalência tem falso conflito se o servidor normalizar texto (ver seção 4).
- O mock não tem concorrência real, expiração por tempo, limite de payload nem latência variável.
- Sem comparação de nomes duplicados; sem paginação (catálogo pequeno).
- `httpGateway` não envia `AbortSignal` no PUT (salvamento não é cancelável de propósito).

## 8. Mock x backend real: diferenças a esperar

| Assunto | Mock | Backend real (previsto) |
| --- | --- | --- |
| Ids | `item_<uuid>`, `v_<uuid>` gerados no cliente | Gerados pelo servidor |
| `revision` | Inteiro em texto, +1 por gravação que muda algo | Opaca (`"r0"`...), via `If-Match`/`ETag` |
| Gravação sem mudança | Não avança a revisão | A confirmar |
| Replay do mesmo pedido | 409 | 409 |
| Erros | Só pelos `?mock=` | 400/401/403/409/410/428/5xx reais |
| Auth | `/api/auth/*` simulado nos E2E (rotas reais cobertas por `auth-routes.spec.ts`) | Cookie HttpOnly + CSRF por `Origin` (F2) |
| Latência | 700 ms fixos | Variável |

## 9. Como conectar o painel à F3A.2 (passo a passo)

Pré-requisito: a branch `feat/catalog-expansion` integrada à base do painel, sem alterar
migrations, auth ou o catálogo público.

1. **Confirmar o contrato final** no código/docs do Codex (`docs/catalog-expansion.md`,
   `functions/api/admin/catalog/…`, `shared/catalog.ts`): rota, método, cabeçalhos
   (`If-Match`), corpo do PUT, forma do GET, `created`, `creationRef`, status e códigos de erro.
   Compare com `wire.ts` e `httpGateway.ts`; ajuste só esses dois arquivos (e seus testes).
2. **Atualizar os testes de wire/HTTP** para o formato final (`wire.test.ts`, `httpGateway.test.ts`).
   Rodar contra respostas reais capturadas localmente (Miniflare), nunca contra D1 remoto.
3. **Trocar o gateway** em `AdminApp.tsx`:
   ```ts
   const gateway = useMemo(() => createHttpGateway(), [])
   ```
   Remover o import de `mockGateway`/`readMockMode`. O teste de fronteira continua válido
   (ninguém mais importa o mock).
4. **Mock fora do caminho de produção.** O `?mock=` já é ignorado no build publicável, mas
   `mockGateway.ts`/`mockData.ts` ainda são o gateway padrão do `AdminApp`. Ao trocar (passo 3) eles
   deixam de ser importados pela aplicação; mantenha-os só para testes (mova para `tests/` se
   preferir) e o `--mode e2e` do Playwright só se ainda houver cenários mockados.
5. **Revalidar a premissa de recuperação**: GET devolve `creationRef` para item e variante; retry de
   escrita já gravada responde 409. Se o backend oferecer outra forma (ex. idempotency key), troque
   só `saveFlow.classifyUncertain`.
6. **E2E contra as Functions locais**: substituir, em `e2e/admin-*.spec.ts`, o `?mock=` por interceptações
   (`page.route`) ou por contas descartáveis locais; manter os cenários lost-response, 401 e 409.
7. **Rodar todos os comandos da seção 6** e testar manualmente, em ambiente local: criar vários produtos,
   reordenar, derrubar a rede no meio do salvar, expirar a sessão.
8. Só então pedir autorização para commit/push/PR. Nada disso foi feito nesta etapa.

## 10. Riscos e trabalho restante

- **Contrato**: o maior risco é a divergência com a F3A.2 final. Mitigado por ficar isolado em
  `wire.ts` + `httpGateway.ts` com validação estrita (forma inesperada vira "indisponível", nunca um catálogo parcial).
- **Duplicação por reenvio**: o desenho depende de `clientId` estável e de 409 no replay; validar no backend real.
- **Perda de rascunho** em recarga/fechamento (seção 7). Decidir se vale persistir.
- **Painel ainda sobre o mock**: enquanto o passo 3 não for feito, `/admin` num deploy mostra o
  catálogo fictício (sem `?mock=`) e "salvar" não grava nada real. **Não publicar a F3B sozinha em
  produção** sem a integração (ou sem esconder a rota).
- Restante: ligar o gateway, e2e contra Functions locais, decidir edição de rótulo/volume de variante
  persistida e remoção de itens (fora do escopo atual).

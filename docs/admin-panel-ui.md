# F3B — interface do painel administrativo

Interface React + TypeScript com CSS Modules, em `/admin`. Referência visual: PDF aprovado
`Chopp-Delivery-Delegas-A-Painel-Modais.pdf` (painel desktop, mobile, modais e estados).
Backend, migrations, autenticação (F2), catálogo público e contratos de API **não foram
alterados**. Nenhuma dependência nova.

## O que está integrado e o que é mock

| Parte | Estado |
|---|---|
| Login, sessão e logout | **Real**: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` (F2), com o cookie HttpOnly do navegador. |
| Catálogo (listar, salvar preços, visibilidade, ordem) | **Mock isolado**: `catalog/mockGateway.ts` + `catalog/mockData.ts`. Nenhum endpoint foi inventado. |

Para ligar a F3A: implementar `AdminCatalogGateway` (`catalog/gateway.ts`: `load` e `save`,
erros como `AdminApiError`) e trocar a linha do `createMockGateway` em `AdminApp.tsx`.
Os componentes não mudam.

### Pontos que dependem do contrato da F3A

1. **Formato do payload.** A UI trabalha com `AdminCatalog` (`catalog/types.ts`): duas listas,
   `chopes` e `cachacas`, já na ordem de exibição, e o token `revision` (ver "Edição concorrente"); preços em **centavos inteiros**, `null` =
   "não vende". O adaptador da F3A mapeia produtos/cachaça (e `sort_order`) para isso.
2. **Salvar.** O gateway recebe o catálogo inteiro. Se a API for por item/PATCH, o adaptador
   calcula o diff (a UI já sabe quais ids mudaram: `changedIds` em `catalog/draft.ts`).
3. **Cachaça.** Hoje é singleton no D1 (`cachaca`, um registro). A aba lista um item; se a API
   mantiver singleton, a aba continua válida. Preço da garrafa é obrigatório (`NOT NULL`).
4. **Ordem.** Reordenar troca vizinhos e envia a lista inteira. Se a API aceitar só
   `sort_order` por item, o adaptador traduz.
5. **Erros.** `unauthenticated` (401) volta ao login com aviso; `unavailable`/`rejected` mostram
   o aviso de falha sem perder o rascunho. Falta definir a mensagem de validação do servidor
   (ex.: preço inválido) para exibir por campo.
6. **Origem/CSRF.** As escritas da F2/F3A exigem `Origin` igual a `ADMIN_ORIGIN`. O painel só
   funciona servido pela origem do Pages (não pelo proxy do Vite). Ver "Como ver".
7. **Fotos.** O modal "Trocar foto" do PDF **não foi implementado**: não há contrato de
   upload. O tile de foto é apenas um espaço reservado.

### Edição concorrente: Salvar nunca sobrescreve em silêncio

Sem controle de versão, "salvar o catálogo inteiro" seria *last-write-wins*: quem abriu a
página ontem apagaria a edição que outra sessão (ou outra aba) salvou hoje. A UI já impõe a
regra; a F3A precisa cumpri-la. **Contrato necessário** (sem definir rotas — a forma HTTP é
da F3A):

1. **Token de revisão opaco.** A leitura administrativa devolve `revision` (string) junto
   com o catálogo. Pode ser um contador, um hash do conteúdo ou `max(updated_at)`; a UI só o
   repassa. O mínimo aceitável é uma revisão do catálogo inteiro; uma versão por linha permitiria
   mesclar no futuro (hoje a UI recarrega em vez de mesclar).
2. **Escrita condicional.** O pedido de salvar carrega a `revision` em que a edição se baseou
   (`AdminCatalog.revision`; em HTTP, `If-Match` ou campo no corpo — decisão da F3A).
3. **Comparação e gravação atômicas, no D1.** A revisão é comparada na própria escrita
   (`UPDATE … WHERE revision = ?`, `changes === 1`, dentro do mesmo `batch`/transação das
   linhas alteradas, junto da `adminWriteProof` descrita em `docs/admin-auth.md`).
   Um SELECT prévio separado reabre a corrida. Escrita parcial é inaceitável.
4. **Recusa explícita.** Revisão diferente ⇒ nada é gravado e a resposta é um conflito
   (HTTP 409 ou 412) que o adaptador traduz para `AdminApiError('conflict')`. Idealmente
   a resposta já traz o estado atual.
5. **Sucesso devolve o catálogo salvo com a `revision` nova**, que vira a base da próxima edição.
6. **Revisão avança em qualquer escrita administrativa** (preço, visibilidade, ordem, cachaça),
   incluindo as feitas por outras telas/rotas futuras.

Comportamento já implementado na UI (testado com o mock, que aplica a mesma regra):

- Conflito ⇒ modal "O catálogo mudou": nada foi salvo; **Recarregar catálogo** (descarta o
  rascunho e busca o atual) ou **Continuar editando** (mantém o rascunho para copiar valores).
- Enquanto o conflito não é resolvido, **Salvar não chama o servidor**: só reabre o aviso, e a
  barra diz "O catálogo mudou em outra sessão. Recarregue para poder salvar."
- **Descartar** em conflito recarrega do servidor (o "salvo" local está obsoleto).
- Duplo clique em Salvar é ignorado enquanto salva; o sucesso troca a base pela `revision` devolvida.

O que a UI **não** faz: mesclar automaticamente campos de sessões diferentes (exigiria revisão por
linha) nem detectar a mudança antes de salvar (sem *polling*; o servidor é a fonte da verdade).

### Cenários do mock (`?mock=`)

`/admin?mock=slow` (carregamento lento), `error` (1º carregamento falha), `empty`,
`save-error` (salvar falha), `expired` (salvar devolve 401) e `conflict` (outra sessão salva
antes: o Dronken 30 L vira 530,00 e o primeiro salvar é recusado). Sem o parâmetro: caminho feliz.
Os dados espelham o seed D1 e o PDF; mudanças feitas no mock vivem só na página aberta.
O mock aplica a regra de revisão acima, então serve de referência executável do contrato
(`catalog/mockGateway.test.ts`). `tests/frontend/admin-gateway-boundary.test.ts` garante que só
`AdminApp.tsx` importa o mock; componentes e hooks conhecem apenas `AdminCatalogGateway`.

## Estrutura

```
src/features/admin/
  AdminApp.tsx        rota /admin (lazy), sessão, noindex, escolhe login/painel/indisponível
  AdminShell.tsx      cabeçalho + catálogo; aviso ao sair com alterações
  AdminHeader.tsx
  login/              LoginScreen (formulário real da F2)
  session/            authApi (fetch das rotas F2), useAdminSession
  catalog/            types, price (parse/format), draft (dirty/validação), gateway,
                      mockGateway/mockData, useCatalogEditor, CatalogView, ProductRow, PriceField
  ui/                 AdminButton, Modal (<dialog>), ConfirmDialog, Tabs, Switch, Toast,
                      BootSplash, useToast, useFlip
src/app/App.tsx       /admin carrega AdminApp por import() — o site público não baixa o painel
public/_redirects     /admin/ → /admin (assets relativos exigem a URL sem barra final)
e2e/admin-panel.spec.ts
```

## Decisões e desvios do PDF (para aprovação)

O PDF mostra só a tabela de produtos e os modais/estados. Itens pedidos que **não estão
no PDF** foram feitos na mesma linguagem visual:

- **Login**: tela nova (selo, título em Big Shoulders, formulário no painel com filete dourado).
- **Abas Chopes / Cachaças**: mono maiúsculo com sublinhado dourado.
- **Ordenação**: coluna "Ordem" com botões ↑ ↓ (alvo de 48 px). No celular, uma faixa
  "Posição N de M" dentro do cartão. Sem arrastar (alternativa acessível a gestos).
- **Vermelho de erro** (`--admin-danger`): única cor fora de preto/dourado/branco, usada em
  borda e texto de campo inválido, aviso de erro e erro de login.
- **"Sair"** também no celular (o PDF mobile só mostra "Ver o site"); nome do usuário no desktop
  (o PDF tem o placeholder `[email do usuário]`; a F2 só tem `username`).
- **Descartar** fica desabilitado sem alterações (no PDF aparece ativo).
- **Tela de falha de carregamento**: no PDF a saída é o WhatsApp (tela do site); no painel as
  saídas são "Tentar de novo" e "Ver o site".
- **`/admin/` → `/admin`** (`public/_redirects`, 301): os assets do Vite são relativos
  (`base: './'`), então a URL com barra final carregaria o HTML sem scripts. Verificado no Pages
  local (`wrangler pages dev`): a query string (`?mock=…`) é preservada e o hash (`#…`) é mantido
  pelo navegador; coberto em `e2e/admin-panel.spec.ts`. O comportamento da produção não foi
  verificado (sem deploy). Variantes exóticas (`/admin//`, `/admin/index.html`) não são
  tratadas e não têm link.
- Linha alterada ganha filete dourado à esquerda e texto oculto "Alterado, ainda não salvo.".
- Tabela a partir de 64 rem; abaixo disso, cartões (o site usa 48 rem como único breakpoint).

## Comportamento

- **Preço (máscara monetária, `PriceField` + `catalog/price.ts`)**: digita-se em centavos, da
  direita para a esquerda (`4` → `0,04`, `49` → `0,49`, `490` → `4,90`, `4900` → `49,00`,
  `125050` → `1.250,50`, máximo `99.999,99`). Todo caminho de edição (teclado físico, IME/teclado
  virtual, recortar, Backspace/Delete, Ctrl+A) chega pelo evento `change` e é recalculado a
  partir dos dígitos: o 8º dígito é recusado, não numéricos são ignorados, zero e vazio ficam
  vazios ("não vende" nos barris; a cachaça mostra `0,00` e exige preço). Depois de cada edição o cursor
  vai para o fim; a seleção ao focar (Tab, Ctrl+A, clique duplo) é respeitada. `inputmode="numeric"` abre o teclado numérico no celular.
- **Colar**: substitui o campo inteiro e só aceita leitura única: `R$ 490,00`, `1.250,50`,
  `490,5`, `490.50`. Recusa o ambíguo, com aviso e mantendo o valor anterior: `490` (reais ou
  centavos?), `1.250` (milhar ou decimal?), `1,250`, `1,234.56`, mistura de separadores, zero
  e acima do limite.
- **Estado canônico**: o rascunho guarda o texto mascarado e o catálogo salvo recebe centavos
  inteiros ou `null` (`buildCatalog`), sem `parseFloat`. Regras: mínimo 1 centavo, máximo
  9.999.999; cachaça exige preço; produto visível exige ao menos um tamanho com preço.
  Digitar de volta o valor salvo não conta como alteração pendente.
- **Chope visível sem nenhum preço** é recusado ("Informe ao menos um preço ou oculte o produto.").
- **Salvar** mostra giro no botão ("Salvando…", sem perder o foco), depois o aviso
  "Salvo. As mudanças já estão no site." por 3 s. Falha mantém o rascunho.
- **Descartar** e **Sair com alterações** usam modal destrutivo: Esc e clique fora não fecham,
  foco inicial e botão dourado = opção segura. `beforeunload` avisa ao fechar a aba.
- **Logout**: só volta ao login quando o servidor confirma; se a chamada falha, mantém a
  sessão e avisa (o cookie pode continuar válido).
- `robots: noindex` e título "Painel Delegas" enquanto o painel está aberto.

## Movimento e acessibilidade

- Só `transform` e `opacity` (mais `scaleX` no sublinhado da aba, FLIP na reordenação).
- `prefers-reduced-motion: reduce` desliga animações e transições (CSS) e o FLIP/atraso de
  fechamento do modal (JS). O giro do botão vira anel parado; o rótulo informa o estado.
- Modal sobre `<dialog>` nativo (resto da página inerte, foco devolvido ao fechar) + laço de
  Tab próprio; vira folha inferior abaixo de 48 rem. Abas no padrão ARIA (setas/Home/End).
  Interruptores são `role="switch"`. Campos têm `aria-label` completo, `aria-invalid` e
  `aria-describedby`. Reordenar anuncia a posição por região `aria-live`.
- **Contraste** (WCAG, calculado em `tests/frontend/admin-contrast.test.ts` a partir dos tokens
  reais): vermelho de erro `#ff8d78` = 9,3:1 sobre preto, 8,3:1 sobre o painel do modal e 7,3:1
  sobre o trilho `steel` (AAA para texto pequeno); texto auxiliar `muted` ≥ 7,0:1; dourado ≥ 8,7:1;
  preto sobre dourado/creme ≥ 8:1. O placeholder "não vende" foi clareado de `#6a6354`
  (3,5:1) para `#8a8272` (5,5:1) porque transmite informação; a descrição de item oculto usa
  opacidade 0,75 (4,5:1). Botões desabilitados são isentos pelo WCAG.
- **Trava de rolagem sem deslocamento** (`ui/scrollLock.ts`): o modal trava a rolagem no `body` (não
  no `html`) e compensa a barra de rolagem clássica que some, com `padding-right` no `html`
  medido na hora (0 no celular, onde a barra é sobreposta) e somado ao padding existente.
  Antes, `html { overflow: hidden }` fazia o conteúdo centrado andar 7,5 px (1440) ou 15 px
  (janelas estreitas) e, como o `body` tem `overflow-x: hidden`, ele virava contêiner de rolagem
  e a barra `sticky` saía da tela. A trava é contada (modais sobrepostos), preserva `scrollY` e
  devolve o foco. `scrollbar-gutter: stable` foi avaliado e descartado (ver testes em
  `e2e/admin-scroll-lock.spec.ts`, que rodam com a barra visível).
- Alvos de toque ≥ 48 px, `touch-action: manipulation`, `color-scheme: dark`,
  `scroll-margin-bottom` nos controles do conteúdo para a barra fixa não cobrir o campo focado.

## Como ver

Com o backend F2 real (cookie de sessão), a origem precisa ser a do Pages local:

```powershell
npm.cmd run build
# .dev.vars com ADMIN_ORIGIN/ADMIN_PASSWORD_PEPPER (ver docs/admin-auth.md) e a conta criada
npm.cmd run dev:backend      # http://127.0.0.1:8788/admin
```

Sem backend de auth, `npm run dev` (Vite) abre `/admin`, mas o login fica indisponível.

## Testes

- Unitários (Vitest): `price.test.ts`, `draft.test.ts`, `authApi.test.ts`.
- E2E (Playwright, Chrome): `e2e/admin-panel.spec.ts` — login, abas, edição/salvamento,
  validação, reordenação, modais (Esc, foco preso, folha inferior), estados, teclado,
  movimento reduzido, mobile 390 px, `/admin/` e ausência do chunk do painel no site.
  A sessão é simulada no navegador (`page.route`); as Functions reais da F2 têm seus próprios
  testes (`tests/backend/auth*`, `e2e/auth-routes.spec.ts`).

## Fim de linha (.gitattributes)

O Git para Windows vem com `core.autocrlf=true` (config de sistema). O índice do repositório é
LF, mas um `git worktree add` gravava os arquivos em CRLF, e o Biome (`lineEnding` padrão `lf`)
acusava 103 erros de formato — só quebra de linha, sem diferença de conteúdo. A causa foi
corrigida com `.gitattributes` (`* text=auto eol=lf`): checkouts passam a sair em LF em qualquer
máquina, sem alterar regras do Biome nem reformatar arquivos antigos. Nenhum blob existente muda.

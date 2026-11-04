# CMS M2B — biblioteca visual de imagens no editor "Página inicial"

Baseline: `integration/immersive-cms-f4a`, `180a74dd2461972ac8f2b54f7bf99ee9babd91d2`.

Escopo: somente frontend do painel e a prévia autenticada. Sem alteração de backend, contratos
`shared/cms`, migrations, homepage pública, publicação, `wrangler.jsonc` ou dependências.

## O que o administrador faz

1. Em **Página inicial**, seções com espaço de imagem (`hero`, `about`, `highlight`) mostram o campo
   **Imagem** com "Escolher imagem" / "Trocar imagem" / "Remover imagem", a pré-visualização real e o
   **Texto alternativo** (contador 200, validação do contrato, mesma regra de links e `< >` dos demais textos).
2. "Escolher imagem" abre a biblioteca (janela modal, folha inferior no celular): cota consumida/restante,
   regra de formato e tamanho, envio de PNG/JPEG/WebP e galeria paginada (12 por página) com miniaturas reais.
3. Escolher uma imagem só altera o **rascunho local**. O upload nunca salva o documento; a associação
   `{ id, alt }` só é gravada por **Salvar rascunho** (`PUT /api/admin/site/draft`, `If-Match`, `operationId`,
   mesmos recibos e conflitos da E6.1).
4. A prévia autenticada (`/admin/preview`) resolve as imagens **salvas** pela rota privada
   `GET /api/admin/media/:id/:profile` (`hero` na abertura, `section` nas demais e nas imagens de barril).

## Contratos reutilizados (nenhum novo)

| Uso | Endpoint |
| --- | --- |
| Listar/paginar/cota | `GET /api/admin/media?limit=12&cursor=` |
| Enviar | `POST /api/admin/media` (`Content-Type` real, `X-Operation-Id`, `If-None-Match: *`) |
| Recibo | `GET /api/admin/media/commands/:id` |
| Bytes (miniatura, campo e prévia) | `GET /api/admin/media/:id/:profile` |
| Salvar associação | `PUT /api/admin/site/draft` |

Ficam sem uso na UI: `GET /api/admin/media/:id`, `DELETE` e `reconcile` (continuam compatíveis).

## Regras de segurança e recuperação

- **Pré-validação no navegador** (tipo, assinatura real dos bytes, 5 MB, 6000 px, 12 MP): o servidor recusa
  o resto, mas uma recusa **consome** 1 dos 100 registros vitalícios; filtrar antes protege a cota. Um teste
  confere que os limites do cliente são os de `MEDIA_LIMITS`.
- **Só é selecionável o que o servidor entregou**: `ready` na listagem é `not_checked`. A miniatura carregar
  (a rota verifica ambos os perfis) é a prova de disponibilidade; `Indisponível`, `Processando`,
  `Recusada`, `Excluída` ficam bloqueadas.
- **Sem reenvio automático**: um envio por vez, cliques duplicados ignorados, janela não fecha durante o
  envio. Resposta inconclusiva (rede, 5xx, 408) → consulta o recibo; `404 MEDIA_OPERATION_NOT_FOUND` só
  autoriza repetir manualmente a **mesma** operação (mesmo ID e bytes, idempotente); `202` (em andamento) e
  recibo inalcançável bloqueiam novo envio; recibo `failed` exige nova operação.
- **Sessão expirada** (biblioteca ou envio) vai ao login e devolve as edições locais, como no salvamento.
  Conflito de revisão nunca sobrescreve; a escolha continua no rascunho local.
- Trocar imagem = outro ID; a anterior permanece na biblioteca, intacta. O texto alternativo é mantido
  para o administrador conferir (primeira associação começa vazia; o rascunho aceita vazio, a publicação exigirá).
- Protegidos: `carousel.media` e as imagens de entradas da vitrine são **preservadas, nunca editadas**
  (função visual indefinida / entradas vêm do catálogo); preços, catálogo e ids seguem somente leitura.
- Nenhuma chave de armazenamento, hash ou manifesto chega ao navegador (os parsers recusam campos extras).

## Prévia

Placeholder substituído por `<img src="/api/admin/media/:id/:profile">`. Qualquer erro (ausente, não pronta,
corrompida, sem biblioteca) cai no espaço reservado "Mídia privada não carregada". A prévia lê o último
rascunho **salvo**; escolhas locais não aparecem. CSP existente (`img-src 'self'`) já permite a rota.

## Ambientes

Biblioteca ativa apenas com o laboratório local (`CMS_MEDIA_LOCAL=disposable-v1`, HTTP localhost, R2/Images
emulados). Em qualquer outro ambiente as rotas respondem 404 e a janela explica "A biblioteca de imagens não
está disponível aqui", sem oferecer envio; o texto continua editável.

## Arquivos

Novos: `src/features/admin/site/media/` (`mediaApi`, `mediaModel`, `useMediaLibrary`, `useMediaUpload`,
`MediaPicker`, `MediaSlot`, `MediaImage`, CSS e testes), `src/features/admin/site/EditorField.tsx`
(extraído do `HomeEditor`), `src/features/admin/mediaPath.ts`, `e2e/admin-site-media.spec.ts`.
Alterados: `HomeEditor`, `editModel`, `siteModel`, `cmsCommands` (export de `send`/`errorCode`),
`ui/Modal` (variante `wide`, foco preso ignora `input[type=file]`), `PreviewRenderer`, `Preview.module.css`
e testes (`tests/e2e-real/admin-real.spec.ts`, `model.test.tsx`, `editModel.test.ts`, `siteModel.test.ts`).

## Limitações e riscos residuais

- Cota vitalícia de 100 registros (recusadas e tombstones contam), sem GC destrutivo, sem substituição de
  bytes no mesmo ID, sem retenção do original, R2 remoto/staging/produção desligados, publicação desligada.
- Cada miniatura é uma leitura verificada de **dois** objetos com evidência gravada pelo servidor
  (M2A). 12 miniaturas por página, carregadas sob demanda (`loading="lazy"`); o custo de revalidação e a
  retenção dessas evidências seguem como decisão futura. As miniaturas usam o perfil `section` (até 1200×900).
- Sem arrastar-e-soltar, sem recorte/foco da imagem e sem escolher imagem de barril (entrada de catálogo).
- Sem rate limit novo; o servidor é a autoridade de todas as validações.

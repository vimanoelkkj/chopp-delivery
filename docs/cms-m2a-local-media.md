# CMS M2A — consultas e derivados privados no laboratório local

Baseline: `integration/immersive-cms-f4a`, `a25b0231415ba778298ac8665c30c44069f776f2`.

## Contrato implementado

| Método/rota | Resposta e limites |
| --- | --- |
| GET `/api/admin/media?limit=20&cursor=...` | `media[]`, `nextCursor`, `capacity`. Limite 1–25, default 20; ordem created_at/id descendente. Cursor retornado pelo servidor, passado com URL encoding; parâmetros desconhecidos/duplicados ou cursor inválido recebem 400. |
| GET `/api/admin/media/:id/:profile` | Derivado WebP somente para `hero` ou `section`, mídia ready e conclusão upload/job/recibo coerente. |
| GET `/api/admin/media/commands/:id` | Recibo terminal original, 202 para job running, 404 para ID desconhecido, sempre autenticado e limitado ao ator da operação. |

A coleção mantém o POST de upload já existente. GET por ID de mídia, DELETE e reconcile permanecem compatíveis. O roteamento Pages está coberto no E2E real, incluindo a precedência de commands sobre a rota dinâmica de perfil.

Itens da listagem contêm apenas `id`, `state`, `revision`, `profiles` e `integrity`. Para ready, perfis são os declarados pelo ciclo de vida e `integrity: not_checked`; para outros estados, perfis vazios e `integrity: unavailable`. Listar não acessa R2 nem atesta disponibilidade de bytes. Não confundir ready/listagem com verificação atual. A entrega de bytes verifica ambos os perfis e falha se qualquer objeto do manifesto estiver inconsistente.

`capacity` contém `limit:100`, `consumed`, `remaining` e `includesTombstones:true`. Conta TODOS os registros, inclusive rejeitados e tombstones. O total e a página são lidos no mesmo batch D1, sob prova de sessão. A paginação é por chave, não offset; não é uma fotografia congelada entre requisições. Uploads posteriores podem exigir atualizar a primeira página.

Nenhuma resposta inclui chave R2, SHA interno, manifesto, ator ou token de sessão/lease. Nenhum contrato CMS v2 foi alterado. Os novos DTOs são somente respostas da biblioteca administrativa.

## Segurança da entrega

O gate compartilhado é o mesmo já existente: flag disposable-v1, HTTP localhost/127.0.0.1, configuração local explícita, bucket e processador presentes. Sem capacidades, em runtime normal ou origem HTTPS/remota, as rotas permanecem 404. Sessão F2 é obrigatória; headers noindex não substituem autorização. Não há URL pública do bucket nem token em URL.

`readVerifiedMediaObjects` reaproveita as validações de manifesto, identidade, tamanho, MIME, SHA-256, container e dimensões. Retorna os buffers que efetivamente verificou e registra a evidência existente no D1. A API legada `verifyMediaObjects` continua retornando o checkId, por delegação; uploads/GET/reconcile históricos mantêm suas verificações.

Depois da leitura, a entrega confere novamente sessão e mídia ready, revisão/manifesto inalterados e upload concluído com recibo. Exclusão ou revogação durante a leitura recusam a imagem. Envia o buffer já verificado, sem segundo GET ao bucket; adulterar o objeto depois da leitura não troca os bytes da resposta. O ponto de autorização final não é uma transação distribuída: não promete cancelar bytes já autorizados/enviados nem disponibilidade futura de R2.

Headers de sucesso: Content-Type image/webp, Cache-Control no-store, X-Content-Type-Options nosniff, Cross-Origin-Resource-Policy same-origin e Content-Length. Não há cache condicional/304 ou exposição de ETag baseado em hash. Erros são JSON genérico: sessão 401, ID/perfil inválido 400, mídia ausente/não pronta/excluída 404, falha de integridade/armazenamento 503. Erros não expõem detalhes internos. Apenas GET é aceito nos dois endpoints novos.

## Operações inconclusivas

Consulta diretamente cms_media_jobs e cms_media_receipts existentes; não cria outro ledger, não grava um novo comando e não reenvia uploads.

- Terminal done ou failed: HTTP 200 com o recibo histórico original. O cliente deve ler operation.status; 200 não significa necessariamente upload aprovado.
- Running: HTTP 202 com outcome unknown; reconciliationRequired indica lease expirada. A consulta não executa reconciliação ou terminalização.
- Desconhecido: HTTP 404 com outcome unknown. Não comprova ausência definitiva de uma escrita em voo e não autoriza criar outra identidade/reenvio automático.
- Recibo terminal ausente/inconsistente: 503, sem fabricar resultado.

O recibo pode continuar descrevendo o upload ready depois de uma exclusão posterior: é um fato histórico, não a disponibilidade atual. Consultar estado/derivado para uso da imagem. O E2E simula a perda da resposta após commit e consulta o resultado por GET antes de qualquer replay manual do teste legado.

## Arquivos e dependências

Modificados: functions/api/admin/media.ts; server/cms/media-library.ts (extração do gate e Allow da coleção); server/cms/media-integrity.ts (buffers verificados/API legada); tests/e2e-real/admin-real.spec.ts (ampliação do cenário existente).

Novos: server/cms/media-queries.ts; functions/api/admin/media/[id]/[profile].ts; functions/api/admin/media/commands/[id].ts; tests/backend/media-queries.test.ts; este relatório.

Fluxo: rotas → media-queries → autenticação/prova D1 + gate local → integridade/bytes + bucket privado. Não há import do frontend, renderer ou contrato comercial novo. A dependência de tipo MediaBucket em media-integrity é apagada na compilação; não introduz ciclo de runtime.

Graphify consultado antes e depois, com inspeção direta complementar. Grafo existente: 1887 nós, 265/244 candidatos nas consultas, saídas truncadas a 37/26 nós. Não foi regenerado para preservar os artefatos externos; ele não indexa os novos símbolos desta entrega. A análise pós-alteração dos novos imports foi feita diretamente. Nenhuma configuração/hook foi modificada; consultas podem atualizar last_query_stamp operacional.

## Testes e gates

- Primeira tentativa do arquivo novo: módulo ainda ausente, falha de importação. Isso não foi apresentado como prova comportamental de regressão.
- Primeira rodada implementada: 13/14 passaram; um POST de teste sem Origin recebeu corretamente 403 em vez do 405 esperado. Corrigida só a preparação da requisição com Origin válido, sem alterar o guard.
- Sete arquivos de mídia/segurança/publicação: 122/122, exit 0, maxWorkers=1, 126,39 s. Inclui 15 casos novos, regressões de upload, container, falhas adversariais, upgrades, referências históricas e cota de 100 tombstones.
- Controle adicional de expiração temporal da sessão foi acrescentado depois; o arquivo novo, agora com 16 casos, passou 16/16 na reexecu??o direcionada, exit 0 (queries-final.log).
- E2E real Pages: 1/1, exit 0, 9,2 s. R2/Images emulados, sessão real, bytes WebP decodificáveis, ausência de sessão, recibo por GET, resposta perdida, referências protegidas e rota pública de bytes ausente.
- Typecheck, Biome, build normal + verify:dist e build release + verify:release: exit 0. Biome global contém avisos/informações preexistentes fora da entrega; arquivos alterados foram formatados e verificados sem novas advertências.
- Sem execução de suites integrais Vitest/E2E. Bancos/buckets dos testes são descartáveis e isolados; somente migrations aprovadas existentes foram aplicadas pelos harnesses. Nenhuma migration criada/modificada.

Evidências e manifesto SHA-256 automático: `%TEMP%/chopp-cms-m2a-a25b023/` — before.json, backend.log, queries-final.log, pages.log e delivery-manifest.json. O manifesto não inclui configurações externas, a correção CP0 nem o grafo.

## Checkpoint e riscos residuais

**GO técnico para M2B local, sujeito à avaliação desta entrega.** Não autoriza ativação remota ou uso continuado. Cota vitalícia, rejeições que consomem capacidade, retenção permanente dos históricos, ausência de GC e de armazenamento de originais continuam como antes. Leituras de imagens acrescentam evidências imutáveis; política de retenção dessas evidências e custo de revalidar ambos os perfis permanecem decisões futuras. Não há rate limit novo ou promessa de disponibilidade permanente.

M2B poderá consumir as consultas e o saveDraft existentes, mas UI de upload/seleção, mudança do renderer/placeholder e qualquer semântica visual de carousel.media não foram implementadas. Homepage, todo src/, contratos shared, migrations 0001–0009, dependências, wrangler e arquivos protegidos permanecem intactos. Sem publicação, GC destrutivo, commit, staging Git, push, merge, deploy ou R2 remoto. Parar para avaliação.

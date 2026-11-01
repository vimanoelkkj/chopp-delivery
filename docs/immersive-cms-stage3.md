# CMS + Conceito C — Etapa 3: mídia privada descartável

Checkpoint de 01/11/2026, sem commit ou publicação. Branch `integration/immersive-cms-f4a`, baseline `323b9365e4a950ed13dbaf0e9d78d5baa385dd83` confirmado. Índice inicialmente vazio. Os únicos deltas externos iniciais eram Graphify: `.gitignore`, `.claude/settings.json`, `CLAUDE.md`, além de `.claude/settings.local.json` ignorado. Hashes desses quatro arquivos foram registrados e devem permanecer idênticos no fechamento.

## Portabilidade e origem

Snapshot de origem: `e4fd70e0ae8d8e2a3dde7089126763b8beaa6729`. Sem merge/rebase/cherry-pick.

| Arquivos transportados | Tratamento nesta rodada |
| --- | --- |
| functions/api/admin/media.ts, media/[id].ts, media/reconcile.ts | Rotas históricas; opt-in somente loopback descartável |
| migrations/0007_cms_media_local.sql | Bytes históricos preservados |
| server/cms/media-bytes.ts | Validação histórica de containers e leitura limitada preservada |
| server/cms/media-library.ts | Ciclo histórico adaptado à finalização atômica e observação de objetos |
| scripts/local-image-worker.mjs e .d.mts | Worker Images privado, somente emulação local |
| scripts/dev-admin-integration.mts | Opção media=false por padrão; R2/Images somente quando explicitamente solicitados |
| tests/e2e-real/server.mts | Repasse explícito do opt-in local, com allowlist de ambiente |
| tests/backend/media-intake.test.ts, media-library.test.ts, media-upgrade.test.ts | Casos históricos preservados; fixtures passam a aplicar também 0008 |
| tests/e2e-real/admin-real.spec.ts | Bloco histórico de mídia acrescentado à suíte atual; resposta perdida exercitada de verdade no navegador |

O backend CMS v1, contrato documental, migrations 0001–0006, frontend, estilos, assets, catálogo, F2 e configuração Wrangler mantida não foram substituídos. Nenhum binding remoto foi acrescentado.

Arquivos novos de correção: `migrations/0008_cms_media_atomic.sql`, `server/cms/media-integrity.ts`, `tests/backend/media-stage3-fixture.ts`, `tests/backend/media-adversarial.test.ts` e este documento.

## Prova histórica antes das correções

- Código transportado, ainda sem correção arquitetural: 76/76 testes históricos aprovados em três arquivos, exit 0 (historical.log).
- Primeira bateria adversarial fixa: 19 testes; 14 falhas de asserção e cinco aprovações, exit 1 (adversarial-red.log). Não foram erros de importação ou infraestrutura.
- Depois da primeira correção: os mesmos 19 cenários passaram, sem relaxar asserções. A combinação histórica + adversarial então passou 95/95.
- Casos suplementares posteriores aprofundam limites, dimensões e pós-condições; não se atribui retroativamente a eles execução vermelha histórica.
- Um script intermediário de edição falhou antes de gravar a alteração de media-library; a execução parcial correspondente não é prova de regressão nem gate aprovado.

Causas reproduzidas: a conclusão histórica faz UPDATE de mídia e job separadamente; falhas, revogação ou expiração entre escritas deixam ready/running ou ready/failed. O replay apresenta o estado atual da mídia, alterando o resultado original após exclusão. Jobs terminais aceitam mutação direta. GET e reconciliação confiam em manifesto ready sem verificar objetos. Manifestos adulterados podem permanecer ready após falha.

## Matriz adversarial fornecida pelo usuário

A matriz original foi recebida por texto nesta conversa; não há arquivo de diagnóstico do Claude confirmado. As decisões abaixo são desta implementação.

| ID | Prova e garantia |
| --- | --- |
| A1 | ABORT no UPDATE final do job e IGNORE em job/mídia: nunca sucesso parcial; mídia/job terminam coerentes ou a transação inteira permanece pendente |
| A2 | Revogação dentro da finalização aborta todas as escritas e efeitos do trigger; revogação durante processamento também é testada na suíte histórica |
| A3 | Expiração no UPDATE final não promove mídia; reconciliação produz rejected/failed |
| A4 | Interrupção e compensação também indisponível deixam lease recuperável, sem promoção; após expiração, limpeza e terminalização |
| A5 | Recibo persistido é imutável, inclusive após exclusão posterior; E2E aborta a resposta HTTP após persistência e repete a mesma operação sem duplicar jobs |
| A6 | operationId com bytes diferentes retorna 409; ação/alvo diferentes conflitam. Ator diferente não é configurável no modelo F2 de owner único, preservado nesta rodada |
| A7 | Uploads concorrentes têm um vencedor e um conflito; replays concorrentes não duplicam objetos |
| A8 | Corrida exclusão/referência tem somente um sucesso; nunca referência para deleting/deleted |
| A9 | SQL recusa mutação direta de job terminal e mídia fora do comando; recibos/evidências são imutáveis |
| A10 | Objeto ausente falha em GET e reconciliação, com evidência inválida e sem reescrever manifesto |
| A11 | Adulteração com mesmo tamanho falha no SHA-256 |
| A12 | Tamanho, MIME, identidade e dimensões reais divergentes falham; perfil adicional é recusado |
| A13 | Chave inválida/hash malformado e alteração de manifesto durante conclusão não podem produzir ready |
| A14 | Testes históricos recusam WebP com metadados, flags/canvas inválidos e animação; Worker real decodifica/reencoda e remove metadados |
| A15 | Sem Origin/Referer válido, origem cruzada ou Sec-Fetch-Site cross-site: 403, F2 inalterado |
| A16 | Mais de 5 MiB em chunks: 413 sem processamento/objetos; PNG falso, CRC inválido, JPEG truncado/payload e MIME forjado são recusados |
| A17 | Resposta administrativa não expõe objectKey, manifesto, hash interno, ator, sessão ou lease |
| A18 | Upgrade 0006→0007→0008 mantém documento, referências e histórico; catálogo e bloqueio de publicação preservados |

## Modelo transacional D1

0007 permanece intacta. A evolução aditiva 0008 acrescenta:

- `cms_media_start` e `cms_media_command`, views com triggers INSTEAD OF UPDATE.
- Guard transitório `cms_media_write_guard`, inserido e removido dentro do statement, para controlar mutações de mídia/job. Rollback não deixa esse guard persistido.
- `cms_media_receipts`, recibos terminais imutáveis, e `cms_media_checks`, observações imutáveis do manifesto/objetos.
- Triggers para identidade, estados terminais e proibição de mutação fora do mecanismo.

O comando reavalia sessão, usuário ativo, auth_version, origem, expiração, identidade da operação, lease e estado. Processar fixa hash da intenção e estado processing juntos. Concluir exige observação válida do mesmo manifesto e atualiza mídia + job + recibo no mesmo statement. Pós-condições verificam efeitos reais, inclusive contra RAISE(IGNORE); autorização e prazo são conferidos novamente antes do término. Falha em qualquer ponto aborta o statement inteiro.

As transições fail/expire também atualizam mídia e job juntas. Recebimento perdido não autoriza novo efeito: a resposta/replay usa o recibo persistido, com ETag da revisão daquele recibo, sem substituí-lo pelo estado posterior do recurso.

A hipótese de view/trigger foi exercitada no SQLite real do D1 emulado, incluindo ABORT, IGNORE, revogação, expiração e rollback de efeitos de triggers. Isso não é prova de transação distribuída com R2 nem homologação remota.

## Integridade dos objetos

`verifyMediaObjects` exige exatamente hero e section e campos exatos no manifesto. Verifica identidade retornada/chave content-addressed, SHA-256 de bytes efetivos, tamanho declarado e real, MIME armazenado, limites por perfil, dimensões reais e container WebP sem metadados/animação. Observações têm prazo limitado e são persistidas com validade e momento da checagem.

Uma conclusão ready exige a evidência correspondente. GET/replay de recurso ainda ready e reconciliação verificam novamente os objetos e a coerência da conclusão persistida. Objeto ausente/adulterado ou histórico divergente resulta em falha explícita; não se reescrevem manifestos ready para torná-los aparentemente íntegros. Recibos são fatos históricos, não promessa de disponibilidade atual. Após exclusão, replay pode devolver o recibo original ready; a consulta atual é a fonte de estado e integridade.

`publicationMediaErrors` continua sendo somente a validação pura histórica de metadata: não lê R2, não habilita publicação e não pode substituir a observação de bytes em uma fase futura. Publicação continua bloqueada no endpoint, repositório e triggers CMS v1. Um futuro publicador deverá verificar novamente objetos, estado e referências, sem tratar ready ou uma evidência antiga como disponibilidade permanente.

## Recuperação e limites

- Antes de reconciliar, jobs running realmente expirados são cercados e terminalizados atomicamente. Lease válida continua impedindo concorrência cara.
- Workers atrasados não conseguem finalizar após fencing. Efeitos R2 tardios permanecem privados e podem ser encontrados na varredura seguinte.
- Objetos sem dono/fora de manifestos válidos são removidos; mídia referenciada permanece protegida pelas FKs e triggers v1.
- Exclusão parcial conserva deleting e recibo failed; uma operação de reconciliação separada limpa objetos e conclui o tombstone, sem reescrever o job terminal anterior.
- Interrupção de worker é simulada por indisponibilidade de escrita/compensação, conservando o estado durável para recuperação; não se afirma ensaio remoto de crash. Falha de compensação é registrada como recuperação necessária; lease/objetos permanecem privados, sem alegar sucesso.
- Divergência histórica ready/job/recibo é recusada, não reparada silenciosamente. Não se fabricam recibos para registros históricos durante a migration.
- Upload e processamento mantêm limites históricos; list/delete e verificações de R2 têm timeout. Não há agendamento remoto ou GC de retenção histórica nesta etapa.

## Isolamento e preservação

O opt-in de mídia exige flag disposable-v1, loopback HTTP, configuração local insegura explícita e ambas as capacidades privadas. Runtime normal tem media=false, sem service binding Images/R2. Configuração Wrangler e bancos mantidos permanecem intactos. Sem rotas públicas de bytes/manifestos, sem editor visual ou consumo editorial na homepage. Release continua usando gateway HTTP real, nunca fallback mock.

Asserções de preservação do catálogo e dos fluxos comerciais permanecem nos E2E. A antiga expectativa de ausência da tabela de jobs foi adaptada para ausência de jobs ativos no runtime normal: migrations locais agora criam a fundação, porém não habilitam capacidades de mídia. Conteúdo e composição do Conceito C não foram alterados.

## Gates e evidências

| Gate | Resultado final / exit |
| --- | --- |
| Typecheck | PASS, 0 |
| Biome global | PASS, 0; 295 arquivos |
| Vitest completo | 1041/1041, 67 arquivos; 0; 236,64s |
| Adversariais finais | 25/25 dentro do Vitest completo; os 19 originais mantêm as asserções da execução vermelha |
| Build normal + verify:dist | PASS, 0; 87 módulos e 120 literais |
| Build release + verify:release | PASS, 0; 135 módulos e 124 literais |
| E2E público completo | 57/57, 0; 14,3s; sem skip/flaky |
| E2E administrativo completo | 20/20, 0; 3,1min |
| E2E release completo | 20/20, 0; 3,1min |
| Migration real Wrangler em D1 descartável | 0007 e 0008 aplicadas; 0008: 15 comandos com sucesso |
| git diff --check | PASS, 0 |
| Hashes das quatro configurações externas | Idênticos ao início |

A primeira execução completa passou 1040/1040; após o teste suplementar de dimensões e a preservação de ETag no recibo, a suíte final passou 1041/1041. Falhas intermediárias de tipos/imports e a formatação adicional exigida pelo Biome foram corrigidas, sem relaxar expectativas. Uma chamada de formatter precisou de uma segunda passagem na assinatura MediaBucket.get; o lint global final ficou verde.

Logs externos em `%TEMP%/chopp-stage3`: historical.log, adversarial-red.log, adversarial-fixed.log, media-all.log, vitest.log, lint.log, build.log, verify-dist.log, release.log, protected-hashes.json, transport-files.json. Scripts e bancos temporários ficam fora da entrega.

Executar Vitest sem E2E concorrentes: o teste herdado compara diretórios globais TEMP. E2E usam os runtimes próprios, portas distintas e bancos novos com marcador de posse. Não executar db:init/dev:full contra banco mantido para reproduzir esta entrega.

## Riscos residuais

Somente emulação local de D1/R2/Images. Sem garantias remotas de quotas/latência/durabilidade. Verificação é pontual e não elimina a janela entre observação e mutação externa de objetos. Retenção de versões/refs e GC operacional posterior continuam pendentes. Proteções SQL cobrem o caminho da aplicação, não um operador capaz de alterar schema/guards arbitrariamente. O contrato CMS continua v1, com ordem histórica ainda não conectada ao Conceito C.

Nenhum commit, push, PR, merge/rebase, staging Cloudflare, deploy, migration em banco mantido/remoto ou implementação de editor/publicação está autorizado nesta rodada. Parar no checkpoint para auditoria independente.

## Manifesto e veredito

Entrega: 19 caminhos, três rastreados modificados e 16 novos. O manifesto, hashes e origens ficam em `%TEMP%/chopp-stage3/delivery-files.txt`, `delivery-hashes.json` e `origins.json`. Configurações externas e graphify-out não integram a entrega. O grafo AST ignorado foi atualizado conforme CLAUDE.md, sem alterar os quatro arquivos protegidos.

Branch e HEAD permanecem no baseline; índice vazio. Veredito: GO para auditoria independente da Etapa 3 em ambiente descartável. Não é aprovação automática de commit, próxima etapa, staging ou produção.

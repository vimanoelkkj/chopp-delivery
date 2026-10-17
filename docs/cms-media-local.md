# Biblioteca de imagens F4A.2A — laboratório descartável

Implementada por Codex por autorização explícita de substituição do implementador.
Arquitetura local auditada pelo Antigravity; correções P2-1/P3-2 aguardam
reauditoria direcionada. Nenhuma aprovação produtiva.

## Arquitetura implementada

Pages Functions reais -> guard F2 -> D1 emulado + R2 privado emulado.
Pages chama um Worker privado via service binding; somente esse Worker recebe
Images offline. Não há import de sharp nas Functions ou no Worker. O emulador
Images usa processamento nativo no host: isso não prova execução remota.

`startIntegration({media:true})`, ou `DELEGAS_MEDIA_LAB=1 npm run dev:admin:real`,
cria banco e bucket aleatórios, sem configuração remota. Sem opt-in, as rotas
respondem 404. Exigem também HTTP loopback, flag de autenticação local e ambas
as capacidades. HTTPS/produção falha fechado. `wrangler.jsonc` permanece intacto.
R2 usa persistência temporária do Miniflare; D1 fica no diretório temporário
com marcador de posse já utilizado pelo laboratório. Dispose remove ambos.
Não há flags para reutilizar bucket/banco de operador. Staging e produção futuros
precisam de bindings e recursos distintos, credenciais e origens separados;
nenhum desses recursos foi criado ou comprovado nesta etapa.

## Contrato administrativo

Todos os métodos exigem sessão real, usuário ativo, auth_version, origem e
expiração F2. Mutações exigem Origin/Referer e rejeitam Sec-Fetch-Site cross-site.
O predicado de sessão é repetido nas consultas e alterações D1 e antes de efeitos
R2. Não há token de autorização enviado ao processador nem acesso R2 do browser.

| Endpoint | Entrada e precondição | Resultado |
| --- | --- | --- |
| POST `/api/admin/media` | bytes brutos JPEG/PNG/WebP; Content-Type exato; X-Operation-Id UUIDv4; If-None-Match: * | mídia e operação; ETag |
| GET `/api/admin/media/:id` | id media_UUIDv4 | estado, revisão, nomes dos perfis; ETag |
| DELETE `/api/admin/media/:id` | X-Operation-Id novo; If-Match com ETag entre aspas | tombstone; referências bloqueiam |
| POST `/api/admin/media/reconcile` | X-Operation-Id novo; If-Match: "local-media-v1"; sem corpo necessário | recibo de varredura |

Não existe listagem, preview de bytes, download, URL pública, publicação, editor
visual ou rota do Worker privado. GET recupera o estado pelo id determinístico
`media_<operationId do upload>`. Repetir POST com o mesmo id e bytes recupera o
recibo sem reprocessar. Um id representa uma tentativa: falhas terminadas não
reiniciam processamento; use novo id para nova tentativa. Upload em andamento
retorna 409. Reutilização com outro conteúdo/ação/alvo/ator/precondição conflita.
GET retorna estado atual, não snapshot histórico. Respostas não incluem hash do
comando, ator, sessão, chaves ou manifesto interno. Cache-Control no-store.

Precondição ausente: 428; inválida: 400; revisão obsoleta: 412; posse/conflito/
referência: 409; quota: 429; bytes: 413; leitura/processamento excedido: 408;
conteúdo inválido: 400; falha de infraestrutura/processador: 503. Não há fallback
para imagem original quando o processador falha.

## Validação e processamento

Entrada máxima 5 MiB reais, inclusive chunked, leitura total de 5 s e cancelamento.
Content-Length excessivo pode ser recusado antes da reserva; nunca é confiado
como medida real. Uma trava D1 de leitura, inclusive para replays, vence em 20 s.
Há uma operação de armazenamento/processamento ativa por biblioteca, lease de
60 s, sem roubo automático: expiração exige reconciliação autenticada. Máximo
de 100 registros de mídia durante a vida do laboratório, incluindo tombstones.
Não é uma quota comercial ou política de produção.

A inspeção usa Uint8Array/DataView: assinatura e estrutura PNG (CRC, chunks,
IEND/EOF), JPEG (segmentos, SOF, scans e primeiro EOI em EOF; MPF rejeitado),
WebP (RIFF, chunks, dimensão do frame). Rejeita formatos fora da allowlist,
APNG/ANIM/ANMF/flag de animação, truncamentos e MIME divergente. Limites antes
do decoder: dimensão 6000 e 12 milhões de pixels. A inspeção não substitui decode.

Correção pós-auditoria P2-1: WebP exige VP8/VP8L simples ou VP8X único inicial,
canvas separado do frame, um único bitstream e dimensões coincidentes. Valida
padding, campos reservados, ordem ICCP/ALPH e consistência das flags de metadados.
Rejeita chunks conhecidos duplicados, ALPH com VP8L e alpha externo ausente ou
incompatível. Metadados/unknown chunks continuam permitidos na entrada estendida;
derivados rejeitam metadados e chunks desconhecidos. Base:
[WebP Container Specification](https://developers.google.com/speed/webp/docs/riff_container).

Correção P3-2: presença de SOF JPEG tem estado próprio, sem depender de largura.
Exige um SOF suportado, dimensões positivas, comprimento consistente com os
componentes, precisão e descritores de componente válidos. Rejeita SOF duplicado,
conflitante ou depois de scan; continua aceitando baseline/progressivo, grayscale
e CMYK. JPEG com altura inicialmente zero via DNL está fora do subconjunto aceito.
Base: [ITU-T T.81, B.2.2](https://www.w3.org/Graphics/JPEG/itu-t81.pdf).

O Worker faz Images.info, decode/reencode para WebP, perfis hero até 1920x1080
e section até 1200x900. O coordenador limita cada saída a 2 MiB, verifica estrutura,
dimensões, rejeita chunks de metadados e animação. Prazo agregado de 5 s para as
duas conversões e efeitos aguardados dentro do bloco de processamento; abort
é solicitado no timeout. Cancelamento efetivo do decoder remoto não comprovado.
R2/D1 podem continuar pendentes: a lease impede finalização posterior, mas não
cancela uma gravação R2 já enviada. A reconciliação precisa poder ser repetida.

Objetos derivados têm chave `cms/derived/media_UUID/sha256/perfil.webp`, escrita
condicional If-None-Match *, conteúdo WebP e hash conferido por leitura após put.
Uma chave existente nunca é sobrescrita pela aplicação. O original não é gravado
nem servido; `quarantined` é estado D1 de recebimento em memória, sem quarantine_key.
Imutabilidade é uma política da aplicação/put condicional, não Object Lock contra
um operador com acesso arbitrário ao bucket.

## Estados e falhas entre serviços

`0007_cms_media_local.sql` adiciona revisão, jobs e trava de leitura, preserva 0006,
histórico e referências. A criação do job e da mídia, ou a transição de exclusão,
usa trigger na mesma transação D1. Um índice único impede dois jobs running.

Upload: quarantined -> processing -> ready, somente após ambos os objetos e
manifesto íntegros. Erro conhecido: rejected/job failed. Falha D1 total ou sessão
revogada pode impedir compensação; ficam processing/job running até expiração
e reconciliação. `ready` pode existir com job ainda running/failed se a resposta
ou o registro final do recibo falhar depois do manifesto: GET permite diagnosticar.
Não existe transação distribuída D1/R2 nem promessa de rollback dos objetos.

Pendência obrigatória P3, preservada e não corrigida nesta intervenção: finalizar
`cms_media` e `cms_media_jobs` usa alterações D1 separadas e pode deixar estados
divergentes. Requer intervenção específica antes da integração produtiva, com
finalização dos dois registros na mesma transação D1, guards e testes de falha e
concorrência; isso não tornará D1 e R2 atomicamente transacionais entre si.

Na futura F4A.3, antes de publicação, será obrigatório verificar existência e
integridade dos objetos R2 contra o manifesto, mesmo quando o estado for ready,
com testes de ausência/corrupção. As correções de parsing não suprem essa prova.

Exclusão: ready/rejected -> deleting -> deleted. O trigger 0006 bloqueia qualquer
referência em versão imutável, incluindo módulo oculto ou rascunho histórico.
Falha parcial deixa deleting, que não pode ganhar novas referências. Reconciliação
remove os resíduos antes de completar tombstone. Não há GC de versões/referências.

Reconciliação adquire a mesma exclusão global; falha leases vencidas, converte
quarantined/processing vencidos em rejected, pagina `cms/derived/`, mantém apenas
objetos que constem no manifesto ready de seu dono e apaga resíduos/órfãos. Depois
completa deleting. Operação R2 tardia pode criar um órfão depois da varredura:
continua privado e requer nova varredura com novo operationId. A varredura não
verifica/repara ausência ou corrupção de objeto em manifesto ready já confirmado;
verificação de disponibilidade antes de publicação futura permanece obrigatória.

O contrato L0A.2 rejeita publicação de missing/quarantined/processing/rejected/
deleting/deleted e manifestos inválidos. O bloqueio SQL de publicação da 0006
continua ativo: esta etapa não implementa ou habilita publicação. Rascunho pode
referenciar mídia pendente, mas nunca mídia inexistente/deleting/deleted.

## Compatibilidade, bloqueios e custos

Verificação documental em 16/10/2026:

- [Images binding](https://developers.cloudflare.com/images/optimization/binding/):
  recebe bytes; binding é por Worker. Offline suporta subconjunto das operações,
  e usa implementação distinta da remota. `fit`/quality/orientação/remoção de
  metadados e corpus malformado precisam de prova remota específica.
- [Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings):
  Pages pode chamar Worker privado. O laboratório reproduz essa separação; não
  presume Images diretamente disponível em Pages nem configura serviço real.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/):
  128 MB por isolate, compartilhados por invocações; orçamento de CPU depende do
  plano. Deadline de aplicação não comprova orçamento de CPU. Buffer de entrada,
  cópias, outputs e até 48 MB de pixels decodificados exigem medição remota; RSS
  do host Miniflare/sharp não é memória do isolate.
- [Images pricing](https://developers.cloudflare.com/images/pricing/): 5000
  transformações únicas/mês incluídas; plano pago cobra US$0,50/1000 adicionais.
  Dois perfis são duas combinações potenciais por imagem. info não é cobrado.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
  [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) e
  [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/):
  armazenamento, operações/linhas e execução precisam de orçamento e quotas.
  Reconciliação faz list/read/delete e consultas por objeto; custo não é zero
  remotamente. Nenhuma contratação, conta ou cobrança foi realizada nesta tarefa.

Bloqueio técnico explícito: NO-GO produtivo até prova autorizada do Worker/Images
remoto, sanitização (inclusive metadados/orientação/animação/corrupção), memória,
CPU/timeout/cancelamento, concorrência, consistência e custos, além de isolamento
real de staging/produção. Não remover o gate local para contornar esse bloqueio.
Sharp aparece somente em testes e no laboratório anterior como gerador/inspector
de fixtures; nunca como prova de compatibilidade produtiva.

Validação e inventário: [f4a2a-validation.md](f4a2a-validation.md).

# Habilitação da mídia do CMS em produção (preparação)

**Estado: a mídia foi validada de ponta a ponta na HOMOLOGAÇÃO (upload, processamento, associação, entrega pública, proteção de exclusão). Em produção nada foi criado, publicado ou alterado (bucket, Worker, bindings, Access, secrets, D1).** Cada passo remoto exige autorização explícita. O procedimento vigente, com os perfis do guard, os dois gates e a ordem de abrir/fechar, está em [production-release-runbook.md](production-release-runbook.md) (seções 3 e 6); este documento fica como referência de segurança e de causas.

Decisão: o contrato continua exigindo imagem publicável no hero (validador, gatilho SQL da `0012` e inventário `ready`). Não há fallback novo nem migration para dispensar a imagem.

## 1. De onde vem o 409

`MEDIA_BUSY_OR_CONFLICT` é um rótulo genérico de [media-library.ts](../server/cms/media-library.ts): o `catch` final converte em 409 qualquer mensagem que case `BUSY|CONFLICT|UNIQUE constraint|LEASE`. Causas possíveis no código, com o código de telemetria que a Function registra em `CMS_MEDIA_FAILURE` (campos fixos `source`, `stage`, `code`, sem dados sensíveis):

| Código registrado | Condição |
| --- | --- |
| `MEDIA_INTAKE_BUSY` | outro envio ocupa a vaga única de entrada (`cms_media_intake`, lease de 20 s) |
| `MEDIA_INTAKE_LEASE` / `MEDIA_JOB_LEASE` | a lease de entrada ou do job expirou durante o processamento |
| `MEDIA_OBJECT_CONFLICT` | `bucket.put` condicional não gravou: a chave endereçada por conteúdo já existe |
| `MEDIA_CONFLICT` | `operationId` reutilizado com precondição, ação, mídia, ator ou hash diferentes |
| `D1_UNIQUE_CONSTRAINT` / `D1_CONTENTION` | violação de unicidade ou `SQLITE_BUSY/LOCKED` no D1 |

Há ainda um 409 distinto, `MEDIA_BUSY` (job do mesmo `operationId` ainda `running`), e `MEDIA_REFERENCED` (exclusão de mídia referenciada).

**Qual deles ocorreu no 409 antigo da homologação não é determinável pelos arquivos locais.** A resposta do navegador só mostra o rótulo genérico; a causa está nos logs da Function (`code` e `stage`). Na homologação a mídia voltou a funcionar de ponta a ponta com os dois gates abertos e sem esse 409. Criar um bucket R2 não resolve um 409 por si: nenhuma das causas acima é "bucket ausente".

**Falha por gate do Worker (comprovada):** com `CMS_MEDIA_ENABLED=enabled` no Pages e `CMS_MEDIA_PROCESSOR_ENABLED=disabled` no Worker, o upload responde **503 `MEDIA_UNAVAILABLE`** (log `CMS_MEDIA_FAILURE`, `stage=processor.transform`, `code=MEDIA_PROCESSOR`, perfil `hero`), porque o Worker devolve 404 e a Function trata resposta não-OK como falha do processador.

**Produção hoje nunca chega ao 409.** O gate `localMediaEnabled` respondia 404 para qualquer origem que não fosse a de homologação. Agora ele aceita também `https://chopp-delivery-prod.pages.dev`, mas só se `CMS_MEDIA_ENVIRONMENT=production`, `CMS_MEDIA_ENABLED=enabled`, origem exata e os dois bindings existirem. A configuração atual não define nada disso, então segue desligada.

## 2. O que existe e o que falta em produção

| Recurso | Local | Produção |
| --- | --- | --- |
| Migrations `0008` (atômica), `0010` (capacidade), `0012` (publicação) | sim | aplicadas (`0001`–`0012`, `cms_ready_publication = 1`) |
| Upload, derivados `hero`/`section`, recibos, reconciliação | sim | desligado (gate) |
| Entrega pública `GET /api/site/media/{id}/{perfil}` | sim, só mídia da versão publicada | pronta; exige apenas o binding do bucket |
| Bucket R2 privado | descartável nos testes | **falta** (`r2_buckets: []`) |
| Worker processador (`server/cms/image-worker.mjs`, binding `IMAGES`) | emulado | **falta**; disponibilidade do Cloudflare Images na conta e custo não verificados |
| Binding de serviço `CMS_MEDIA_PROCESSOR` | emulado | **falta** (`services` ausente) |
| Variáveis de habilitação | n/a | **faltam** |
| Guarda de deploy | n/a | perfil `base` **proíbe** `r2_buckets` e `services`; os perfis `media-closed`/`media-open` aceitam **exatamente** o bucket `chopp-cms-media-production` e o serviço `chopp-cms-image-processor-production` (runbook, seção 2) |

## 3. Configuração de produção (arquivos prontos, nada aplicado)

Worker processador: [production-media-processor.jsonc](../config/cloudflare/production-media-processor.jsonc) (nasce **fechado**, `CMS_MEDIA_PROCESSOR_ENABLED=disabled`) e [production-media-processor-open.jsonc](../config/cloudflare/production-media-processor-open.jsonc) (idêntico, só com a variável `enabled`; é *enviado* como versão e ativado na janela). Sem `workers_dev`, sem preview, sem rotas nem cron, só o binding `IMAGES`. Não precisa de D1, R2 nem credenciais.

Pages: dois arquivos revisados, [wrangler.production.media.jsonc](../wrangler.production.media.jsonc) (gate `disabled`) e [wrangler.production.media-open.jsonc](../wrangler.production.media-open.jsonc) (gate `enabled`), cada um com hash fixo no guard. O conteúdo acrescentado ao `wrangler.production.jsonc` (que continua sendo o perfil `base`) é somente no contexto principal (`env.preview` continua vazio):

```jsonc
"vars": {
  "ADMIN_ORIGIN": "https://chopp-delivery-prod.pages.dev",
  "CMS_MEDIA_ENVIRONMENT": "production",
  "CMS_MEDIA_ENABLED": "disabled"   // "enabled" só no perfil media-open
},
"r2_buckets": [{ "binding": "CMS_MEDIA_BUCKET", "bucket_name": "chopp-cms-media-production" }],
"services": [{ "binding": "CMS_MEDIA_PROCESSOR", "service": "chopp-cms-image-processor-production" }]
```

O guard (`scripts/production-pages-deploy.mjs`) aceita esses bindings **só** nos perfis de mídia e continua recusando qualquer outro bucket/serviço e qualquer binding no preview; os testes estão em `tests/backend/production-media-profiles.test.ts`.

## 4. Segurança, permissões e limites

- **Bucket:** privado e exclusivo da produção; sem acesso público, sem domínio personalizado, sem `r2.dev`, sem reaproveitar bucket da homologação. Sem token R2 no navegador: o acesso é só pelo binding.
- **Escrita:** apenas `POST/DELETE /api/admin/media*`, atrás do Access, da sessão F2, da checagem de origem/CSRF e da prova de escrita do administrador repetida a cada etapa.
- **Entrada:** PNG, JPEG ou WebP; até 5 MiB, 6000 px por lado e 12 MP; leitura e processamento limitados a 5 s cada; uma única entrada simultânea (lease de 20 s).
- **Derivados:** WebP `hero` 1920×1080 e `section` 1200×900, até 2 MiB, sem EXIF/ICC/animação; gravados com chave endereçada por conteúdo, `put` condicional (nunca sobrescreve) e releitura com SHA-256.
- **Capacidade:** 100 registros (rejeições e tombstones ocupam vaga até a reconciliação).
- **Leitura pública:** somente mídia da versão publicada (`cms_v2_state.published_version_id` → referência → `ready`); rascunho, órfã, rejeitada ou substituída dá 404 idêntico `no-store`. Os bytes são revalidados a cada resposta (SHA-256, tamanho, WebP, dimensões); `ETag` forte, CSP `default-src 'none'; sandbox`, `nosniff`.
- **Access:** `/api/admin/media*` continua privado; `/api/site/media/*` entra na lista pública (padrão exato, sem `/api/*`).

## 5. Ordem de execução (cada passo com autorização)

1. Ler os logs da homologação e identificar o `code` do 409. Se for lease por latência do Images remoto, tratar isso antes de produção.
2. Confirmar Cloudflare Images na conta e o custo.
3. Criar o bucket privado e implantar o Worker processador de produção **fechado** (`CMS_MEDIA_PROCESSOR_ENABLED=disabled`), enviando também a versão aberta (runbook, seção 6).
4. Deploy do Pages com `--profile media-closed` (bindings presentes, gate do Pages fechado), pelo fluxo habitual do guard.
5. Acrescentar `/api/site/media/*` às exceções públicas do Access (apenas com a Proposta B aprovada).
6. Janela supervisionada: abrir o Worker e depois o Pages (`--profile media-open`), enviar uma imagem pequena pelo painel, conferir recibo, derivados e a entrega; fechar o Pages e depois o Worker (runbook, seção 3).

**Reversão:** `deploy --profile media-closed` (`CMS_MEDIA_ENABLED=disabled`) devolve 404 a todo `/api/admin/media`; a mídia já publicada continua servida enquanto o binding existir. Retirar o binding faz `/api/site/media/*` responder 404 e a vitrine mantém suas imagens locais.

## 6. Publicar uma versão anterior ou recuperar uma publicação incorreta

Não há endpoint de "despublicar". As versões publicadas são imutáveis (`cms_v2_versions`, gatilhos SQL) e cada publicação cria uma nova versão. Para recuperar: salvar como rascunho o documento da versão desejada e publicá-lo; o `/api/site` passa a servir esse conteúdo na próxima requisição e o histórico permanece. O E2E local cobre esse caminho. Duas ressalvas: o rascunho precisa referenciar mídias ainda `ready` (mídia excluída após a publicação antiga não volta), e o documento anterior precisa ser lido da versão antiga (`GET /api/admin/site` mostra apenas a publicada atual; a versão antiga está em `cms_v2_versions`).

## 7. Verificação local

`tests/e2e-real/admin-real.spec.ts`, bloco "Publicação do CMS": rascunho → salvar → publicar → `/api/site` → vitrine, com D1 e R2 descartáveis. Controles: publicação incompleta, mídia inexistente, rascunho não publicado, revisão desatualizada, documento diferente do rascunho, replay idempotente, rascunho posterior não publicado, recuperação, e catálogo, preços, variantes e WhatsApp intactos.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npx playwright test --config playwright.release.config.ts -g "Publicação do CMS"
```

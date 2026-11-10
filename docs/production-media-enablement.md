# Habilitação da mídia do CMS em produção (preparação)

**Estado: preparado localmente. Nada foi criado, publicado ou alterado no Cloudflare (bucket, Worker, bindings, Access, secrets, D1).** Cada passo remoto abaixo exige autorização explícita.

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

**Qual deles ocorreu na homologação não é determinável pelos arquivos locais.** A resposta do navegador só mostra o rótulo genérico; a causa está nos logs da Function da homologação (`code` e `stage`). Antes de qualquer nova tentativa remota, ler esses logs (leitura apenas). Criar um bucket R2 não resolve o 409 por si: nenhuma das causas acima é "bucket ausente".

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
| Guarda de deploy | n/a | **proíbe** `r2_buckets` e `services` na configuração e no preview |

## 3. Configuração mínima proposta (não aplicada)

Worker processador, arquivo pronto em [config/cloudflare/production-media-processor.jsonc](../config/cloudflare/production-media-processor.jsonc): sem `workers_dev`, sem preview, sem rotas nem cron, só o binding `IMAGES`, habilitado por variável. Não precisa de D1, R2 nem credenciais.

Acréscimos ao `wrangler.production.jsonc` somente no contexto principal (`env.preview` continua vazio):

```jsonc
"vars": {
  "ADMIN_ORIGIN": "https://chopp-delivery-prod.pages.dev",
  "CMS_MEDIA_ENVIRONMENT": "production",
  "CMS_MEDIA_ENABLED": "enabled"
},
"r2_buckets": [{ "binding": "CMS_MEDIA_BUCKET", "bucket_name": "chopp-cms-media-production" }],
"services": [{ "binding": "CMS_MEDIA_PROCESSOR", "service": "chopp-cms-image-processor-production" }]
```

Mudar esse arquivo muda `PRODUCTION_CONFIG_SHA256`. O mesmo commit precisa: relaxar o guarda em `scripts/production-pages-deploy.mjs` para aceitar **exatamente** esses dois bindings (e continuar recusando qualquer outro bucket/serviço e qualquer binding no preview), atualizar o hash e os testes de `tests/backend/production-pages-deploy.test.ts` que hoje exigem R2/serviço vazios.

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
3. Criar o bucket privado e implantar o Worker processador de produção (`CMS_MEDIA_PROCESSOR_ENABLED=enabled`).
4. Commit único: bindings e variáveis no `wrangler.production.jsonc`, guarda de deploy, hash e testes. Snapshot, preflight e deploy pelo fluxo habitual.
5. Acrescentar `/api/site/media/*` às exceções públicas do Access (apenas com a Proposta B aprovada).
6. Enviar uma imagem pequena pelo painel, conferir recibo, derivados e a entrega privada; só então publicar.

**Reversão:** `CMS_MEDIA_ENABLED=disabled` (novo release) devolve 404 a todo `/api/admin/media`; a mídia já publicada continua servida enquanto o binding existir. Retirar o binding faz `/api/site/media/*` responder 404 e a vitrine mantém suas imagens locais.

## 6. Publicar uma versão anterior ou recuperar uma publicação incorreta

Não há endpoint de "despublicar". As versões publicadas são imutáveis (`cms_v2_versions`, gatilhos SQL) e cada publicação cria uma nova versão. Para recuperar: salvar como rascunho o documento da versão desejada e publicá-lo; o `/api/site` passa a servir esse conteúdo na próxima requisição e o histórico permanece. O E2E local cobre esse caminho. Duas ressalvas: o rascunho precisa referenciar mídias ainda `ready` (mídia excluída após a publicação antiga não volta), e o documento anterior precisa ser lido da versão antiga (`GET /api/admin/site` mostra apenas a publicada atual; a versão antiga está em `cms_v2_versions`).

## 7. Verificação local

`tests/e2e-real/admin-real.spec.ts`, bloco "Publicação do CMS": rascunho → salvar → publicar → `/api/site` → vitrine, com D1 e R2 descartáveis. Controles: publicação incompleta, mídia inexistente, rascunho não publicado, revisão desatualizada, documento diferente do rascunho, replay idempotente, rascunho posterior não publicado, recuperação, e catálogo, preços, variantes e WhatsApp intactos.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npx playwright test --config playwright.release.config.ts -g "Publicação do CMS"
```

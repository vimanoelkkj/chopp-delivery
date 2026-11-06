# CMS Fase 3A — entrega pública de mídia (implementação local)

Somente local. Nenhum deploy, migration, gate, secret ou alteração no processador de mídia.

## Contrato

`GET|HEAD /api/site/media/{mediaId}/{hero|section}` (`functions/api/site/media/[id]/[profile].ts` → `server/cms/public-media.ts`).
O caminho é derivável do ID já presente na projeção `/api/site` (`shared/cms/public-media.ts#publicMediaPath`); o contrato editorial de `/api/site` não mudou e não expõe chaves, manifestos ou hashes.

## Autorização (reavaliada a cada requisição)

Uma consulta D1 exige simultaneamente: ponteiro `cms_v2_state.published_version_id` → versão `kind='published'` → referência em `cms_v2_media_refs` dessa versão → `cms_media.state='ready'`. Rascunhos, mídia órfã, rejeitada/em exclusão e mídia de publicação substituída não passam. O derivado é revalidado (`isValidDerivative`: chave endereçada por conteúdo, MIME, limites). Os bytes do R2 são conferidos (objeto, tamanho, Content-Type, SHA-256, WebP e dimensões) antes de responder. Binding `CMS_MEDIA_BUCKET` ausente ⇒ 404. Não depende do gate da biblioteca (`CMS_MEDIA_ENABLED`).

## Respostas e cache

- 200: `image/webp`, `Content-Length`, `ETag` forte = SHA-256, `Cache-Control: public, no-cache`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`, sem cookies.
- 304 com `If-None-Match` igual ao ETag atual (após a autorização em D1; sem leitura do R2).
- 404 idêntico e `no-store` para ID/perfil inválido, não publicado, rascunho, órfão, estado ≠ ready, manifesto inválido, objeto ausente/corrompido.
- 503 `no-store` genérico para falha de D1/R2/timeout (5 s).
- 405 com `Allow: GET, HEAD`.
- Substituir ou revogar a publicação vale na próxima requisição (o navegador sempre revalida); não há cache imutável.

## Lacunas

- A vitrine ainda não renderiza essas imagens: hero/seções mantêm os assets locais do Conceito C e `carousel.media` segue sem função visual definida.
- Mídia de `carousel.entries[].media` só é servida se estiver nas referências da versão publicada (comportamento atual do SQL).
- Sem teste remoto/E2E; Access na homologação continua cobrindo o hostname.

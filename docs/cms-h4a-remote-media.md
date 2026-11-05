# H4A ? Prepara??o local da biblioteca de m?dia para homologa??o

## Resultado e limites

Baseline: `184636a6ab0300f36f349bf77752128272edb72f`, branch `integration/immersive-cms-f4a`.
Implementa??o local preparada. Nenhum recurso, binding real, secret, migration, deployment ou publica??o remoto foi alterado. Homepage, UI, contratos CMS, SQL e mecanismo de capacidade permanecem inalterados.

## Compatibilidade comprovada e pend?ncias

O c?digo original do processador usa `IMAGES.info/input/transform/output`, n?o importa Sharp. Miniflare implementa esse binding via Sharp no host: sucesso local n?o prova comportamento do encoder remoto. O processador agora ? um m?dulo Worker ?nico (`server/cms/image-worker.mjs`), reutilizado literalmente pelo harness por `readFileSync` no host Node. Nenhum import Node ? levado para esse Worker.

A documenta??o Cloudflare descreve o Images binding para bytes privados e sa?da WebP: https://developers.cloudflare.com/images/optimization/binding/. Tamb?m distingue emula??o offline e servi?o remoto. A capacidade ? documentada na plataforma; disponibilidade/contrata??o na conta e sa?da efetiva remota N?O foram verificadas. N?o foi implementado outro encoder.

O bucket utiliza opera??es compat?veis com binding R2 (get, put condicional, list, delete). N?o exige URL p?blica, token R2 no navegador ou chave resolvida no cliente. A homologa??o futura precisa de bucket privado exclusivo, acesso p?blico/custom domains desativados e sem reutiliza??o de produ??o.

## Habilita??o fechada por padr?o

A API preserva o gate local existente. O novo caminho s? aceita simultaneamente:

- `CMS_MEDIA_ENVIRONMENT=homologation` e `CMS_MEDIA_ENABLED=enabled`;
- `ADMIN_ORIGIN=https://chopp-delivery-homolog.pages.dev` e requisi??o nessa origem exata;
- aus?ncia de `ADMIN_ALLOW_INSECURE_LOCAL` e `CMS_MEDIA_LOCAL`;
- bindings `CMS_MEDIA_BUCKET` e `CMS_MEDIA_PROCESSOR` presentes.

Outras origens, HTTP, previews e produ??o s?o recusados. Essa checagem de capacidade n?o substitui F2 ou CSRF: os handlers e provas de sess?o D1 originais continuam ativos.

O novo `config/cloudflare/media-processor.jsonc` N?O ? implantado nesta entrega. Possui `workers_dev=false`, `preview_urls=false`, rotas e cron vazios, Images com `remote=false` para desenvolvimento e `CMS_MEDIA_PROCESSOR_ENABLED=disabled`. Mesmo se chamado por service binding, o processador desabilitado responde 404. Os harnesses descart?veis habilitam-no explicitamente.

A configura??o Pages atual e o gerador de homologa??o permanecem desabilitados para m?dia. N?o h? bucket, service binding real ou identificador de recurso fict?cio nesta entrega. Em etapa posterior autorizada, o operador dever? incorporar os bindings reais somente ao contexto da origem can?nica de homologa??o, mantendo previews sem bindings e produ??o intacta. `CMS_MEDIA_PROCESSOR` dever? apontar exclusivamente ao Worker privado de processamento; este n?o precisa de acesso D1/R2 ou credenciais F2.

## Fluxo e garantias preservadas

F2/CSRF ? limites e inspe??o dos bytes ? reserva idempotente/capacidade D1 ? processador privado nos perfis hero/section ? WebP inspecionado ? grava??o R2 condicional por chave endere?ada por conte?do ? SHA-256 e leitura de verifica??o ? finaliza??o at?mica D1 e recibo.

A entrega autenticada continua verificando manifesto, chave, tamanho, MIME, SHA-256, dimens?es e container; repete prova de sess?o e estado D1 antes de entregar o mesmo buffer verificado, com no-store/nosniff. Nenhuma chave, manifesto ou hash interno ? enviado ao cliente. Receber um recibo inconclusivo n?o causa reenvio autom?tico. Refer?ncias hist?ricas, tombstones e recibos continuam sob os triggers originais. Exclus?o s? libera capacidade ap?s finaliza??o conclu?da.

## Valida??o

- Testes H4A inicialmente vermelhos: gate HTTPS recusado, configura??o ainda ausente, lifecycle HTTPS bloqueado antes de F2. Ap?s implementa??o, aprovados.
- 59 testes direcionados em cinco arquivos aprovados: `media-homologation`, `media-library`, `media-queries`, `media-capacity-integration`, `cms-v2-media-guard` (inclui 300 documentos diferenciais TS/SQL).
- D1 e R2 usados pelos testes s?o descart?veis; nenhuma conex?o remota habilitada.
- Cobertura H4A: opt-in/origem/ambiente, previews e HTTP negados, Worker desabilitado, perfis restritos, limite de corpo, bytes inv?lidos, F2, CSRF, replay sem segundo job, recibo, entrega privada, objeto corrompido e revoga??o de sess?o.
- Typecheck aprovado. Biome direcionado aprovado, com warning/info preexistentes em `cms-v2-sql-fixture.ts` mantidos sem cleanup fora do escopo.
- Nenhuma su?te completa, E2E geral ou build executado.

## Graphify e escopo

Consultado o grafo existente: localImageWorker ? dev-admin-integration/fixtures; media-library ? autentica??o/contrato; media-queries ? entrega/recibos; UI/editor ? APIs existentes. Confirmado diretamente no c?digo. O grafo existente n?o cont?m ainda o novo m?dulo extra?do; inspe??o manual confirma apenas leitura Node no harness e chamadas Workers ao Images binding, sem imports de React/servidor administrativo no frontend. N?o foi regenerado para preservar os arquivos externos; consulta pode alterar somente cache operacional `last_query_stamp`.

## Riscos e veredito

GO para avalia??o/consolida??o LOCAL. NO-GO para ativar m?dia remota nesta rodada.

Pr?-requisitos de homologa??o remota: autoriza??o separada; Images dispon?vel na conta e custos aceitos; bucket privado exclusivo; service binding privado; Access cobrindo toda a origem; verifica??o real de limites/lat?ncia e WebP sem EXIF/ICC/anima??o; falhas e reconcilia??o R2/D1 testadas remotamente. O encoder remoto pode produzir sa?da recusada pelas verifica??es existentes; nesse caso n?o remover as verifica??es para liberar o upload. O prazo atual de 5s de processamento permanece inalterado e precisa de observa??o real.

N?o h? transa??o distribu?da D1/R2, disponibilidade permanente garantida ou GC novo. Mant?m-se a recupera??o e os recibos existentes. Publica??o editorial e consumo CMS na homepage continuam bloqueados/independentes.

# L0A.2 — prova de mídia, custos e isolamento

Data da consulta e execução: 15/10/2026. Nenhum recurso Cloudflare foi criado ou
consultado com credenciais. Apenas documentação pública foi lida. Não houve
`wrangler --remote`, cobrança contratada, alteração de bindings ou upload remoto.

## Compatibilidade: evidência por camada

| Opção | Evidência | Decisão nesta etapa |
| --- | --- | --- |
| sharp/libvips nativo | Executado em Node local; já instalado via Miniflare/Wrangler | Somente laboratório; não empacotar no frontend/Pages/Worker |
| Images binding em Worker | API documentada; `.info`, `.input`, `.transform`, `.output` exercitados no emulador offline | Candidato preferido ao experimento remoto |
| Pages → Worker por service binding | Integração documentada; dois Workers simulam a chamada local | Candidato a adaptação privada; não provisionado |
| Images direto em Pages | Não consta na lista de bindings Pages consultada | Não presumir suporte direto; verificar futuramente ou usar Worker privado |
| WASM em isolate | Não testado; poderia exigir codec/pacote e memória adicional | Não adicionar dependência sem comparar com Images |
| Cloudflare Images hospedado | Produto documentado, armazenamento e entrega próprios | Alternativa avaliada; não substituir R2 sem nova decisão |

O [binding Images](https://developers.cloudflare.com/images/optimization/binding/)
aceita streams de bytes, documenta entrada até 20 MB e emulação offline parcial.
Este projeto propõe entrada menor: 5 MiB. O teste local não executa o codec remoto.
`.info()` identifica formato/dimensões, mas não substitui decodificação completa.
`anim:false` converte para quadro estático; não comprova REJEIÇÃO de animações.
As [Pages Functions suportam service bindings](https://developers.cloudflare.com/pages/functions/bindings/)
para chamar Workers. A inferência arquitetural é usar um Worker privado de mídia
(sem workers.dev/rota pública) se Images não puder ser ligado diretamente a Pages.
Isso é proposta para validação posterior, sem novo serviço na arquitetura principal.

Miniflare instalado implementa o Images offline com sharp no processo host
(`node_modules/miniflare/dist/src/index.js`, `imagesLocalFetcher`). Não transportar
essa implementação para o isolate. A [compatibilidade Node do Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
não constitui prova de que addons nativos/libvips do host possam ser carregados.

## Prova reproduzível

Na raiz do worktree:

```powershell
node scripts/media-proof.mjs
npm.cmd test -- tests/backend/cms-contract.test.ts tests/backend/cms-media-contract.test.ts tests/backend/cms-media-proof.test.ts
```

Não instala pacotes. Usa sharp 0.35.5 já presente no lockfile como dependência de
desenvolvimento transitiva; se essa resolução deixar de existir, falhar e rever
a prova, sem adicionar automaticamente uma dependência de runtime. O script cria
fixtures em memória, não abre endpoint de upload público, não grava fotos e descarta
o runtime em finally. `dispatchFetch` usa o emulador local, sem chamada ao provedor.

Dois caminhos são exercitados separadamente:

1. **Pipeline Node de laboratório:** limita bytes reais acumulados em stream e
   cancela excesso/timeout, identifica assinatura/contêiner, exige MIME canônico
   correspondente, recusa GIF/SVG/AVIF e animação APNG/WebP. Verifica truncamento
   estrutural PNG/WebP e terminador JPEG; decoder strict valida conteúdo. Não
   confia em extensão, navegador, Content-Length ou somente magic bytes.
2. **Integração local binding:** Worker de entrada encaminha para outro Worker
   por service binding; este usa Images info e gera WebP. As rejeições adversariais
   do caminho 1 NÃO foram comprovadas pelo caminho 2, nem pelo serviço remoto.

Política candidata em `server/cms/media-contract.ts`: JPEG/PNG/WebP estáticos;
até 5 MiB na entrada; lado até 6.000 px e até 12 milhões de pixels; até 2 MiB por
derivado; Hero até 1920×1080 e seção até 1200×900. Perfis são caixas máximas com
proporção preservada, sem ampliar; não implicam crop 16:9 nem dimensões mínimas.
12 MP RGBA representam cerca de 48 MB só de pixels, antes de buffers/codec/cache.

A prova Node executa `.raw().toBuffer()` antes do resize para decodificar a origem
inteira, e reencodifica dois derivados WebP novos, aplicando orientação antes de
remover metadados. O [sharp remove metadados por padrão](https://sharp.pixelplumbing.com/api-output/);
o teste confirma ausência de EXIF/ICC/IPTC/XMP/orientação no resultado e presença
de EXIF na fixture JPEG de origem. Não usa withMetadata na saída.
O [decoder strict e o limite de pixels](https://sharp.pixelplumbing.com/api-constructor/)
são independentes do browser. Os derivados são reabertos pelo decoder e seus hashes
SHA-256 são calculados sobre os bytes finais.

Resultado de referência da execução isolada:

| Campo | Valor |
| --- | --- |
| Ambiente | Windows, Node v26.7.0, sharp 0.35.5, libvips 8.18.7 |
| Escopo declarado pelo programa | LOCAL_NODE_AND_MINIFLARE_OFFLINE_ONLY |
| remoteExecuted | false |
| Verificações | 23/23 |
| Duração do runMediaProof | 990 ms (uma amostra; não benchmark/SLA) |
| Pico RSS do processo inteiro | 204.504 KiB ≈ 199,7 MiB |
| Hero da fixture PNG 2400×1600 | 1620×1080, 3.236 bytes |
| SHA-256 desse Hero | cfa25d992787ce25ef3be14b427fe037b7ef535a46b397477de4b75d86aeb44f |

As 23 verificações: decode/reencode e truncamento para PNG/JPEG/WebP (6);
origem com EXIF; MIME falsificado; assinatura JPEG sem imagem; SVG; GIF;
fixture WebP com dois quadros distintos; rejeição WebP animado; chunk APNG;
lado excessivo; pixels excessivos; excesso de bytes com cancelamento;
excesso repartido em chunks; bytes no limite; deadline/cancelamento de stream;
conteúdo PNG corrompido; Images info e Images output via service binding (2).

## Limites da evidência

- A fixture APNG é um chunk de controle sintético inserido em PNG; prova a recusa
  preventiva do marcador, não um corpus completo de APNG válidos. WebP animado tem
  dois quadros confirmados pelo decoder. Rejeição de todo formato/truncamento
  possível não foi demonstrada; incluir corpus variado e fuzzing antes de upload.
- O fluxo tem deadline real de 5 s; o teste de cancelamento usa 20 ms para uma fonte
  que não entrega bytes. Cada operação nativa tem timeout de 5 s. Não existe prova
  de deadline agregado, cancelamento de codec remoto ou orçamento de CPU por pedido.
- O pico RSS inclui Node, libvips, fixtures e Miniflare, não mede memória por foto
  nem memória do isolate. O [limite documentado de Workers é 128 MB por isolate](https://developers.cloudflare.com/workers/platform/limits/).
  Não copiar o pipeline nativo nem inferir capacidade para processar 12 MP no isolate.
- Os dois codecs locais usam sharp; reabrir resultado não é uma comparação entre
  implementações independentes. A validação é independente do NAVEGADOR. Para o
  experimento remoto, inspecionar os bytes de saída com o decoder local também.
- Header/metadata não provam decodificação completa remota. O Images documenta
  [descarte de metadados em WebP](https://developers.cloudflare.com/images/optimization/features/),
  mas a saída da conta real, orientação/GPS e animação precisam ser verificadas.
- Não foram medidos limites de concorrência, fotos incompressíveis no teto de
  saída, qualidade visual real, vazamento de memória, cold starts ou falha distribuída.
  Limites são política candidata; não uma certificação de produção.

Correções durante a prova: fixture inicial tinha dois quadros iguais, que o encoder
consolidou; foi substituída por quadros distintos e a asserção pages=2 mantida.
A expectativa inicial de largura exata 1920 no binding foi corrigida para 1620,
mantendo altura exata 1080, porque o resize offline preserva a proporção 3:2.
Nenhum timeout ou asserção de rejeição foi relaxado para obter verde.

## Experimento remoto necessário — não executado/autorizado

Após autorização específica de recursos, conta e orçamento:

1. Preparar ambiente exclusivo de staging, Worker privado e service binding Pages;
   usar apenas fixtures sintéticas. Confirmar permissões Images e cobrança vigente.
2. Aplicar limites de leitura antes do serviço, allowlist de formatos e verificação
   de animação antes da transformação; não considerar anim:false como rejeição.
3. Testar `.info`, decode/reencode WebP e dois perfis para válidas, truncadas,
   MIME/assinatura falsos, PNG/WebP animados, EXIF/GPS/ICC/XMP e dimensões limite.
4. Baixar derivados de staging e inspecionar com decoder local; confirmar ausência
   de metadados e de frames extras, formato, bytes, dimensões e SHA-256.
5. Medir CPU/wall time, erros, concorrência, consumo e cancelamento; falha impede
   ready, referência/publicação e exposição de original. Exercitar órfãos e replay.
6. Só aprovar upload depois de demonstrar o pipeline inteiro e plano de recuperação.
   Se Images não permitir provar decode/rejeição/tempo, avaliar codec WASM isolado
   ou alternativa explicitamente aprovada, sem reduzir os requisitos.

## Preços documentados e orçamento hipotético

Valores USD, sem câmbio/impostos. São valores publicados consultados em 15/10/2026,
não confirmação de plano, franquia livre ou fatura da conta. Nada foi contratado.

| Produto | Preço/franquia publicada | Fonte |
| --- | --- | --- |
| Images transformações | 5.000 únicas/mês incluídas; Paid: US$0,50/1.000 adicionais. Free recusa novas transformações acima da franquia. | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Images hospedado (alternativa) | US$5/100.000 imagens armazenadas/mês; US$1/100.000 entregas. Não somar hospedagem se só usar R2. | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Workers | Free 100.000 requests/dia, CPU 10 ms; Paid mínimo US$5/mês, 10 milhões requests e 30 milhões CPU-ms, excedentes US$0,30/milhão e US$0,02/milhão CPU-ms. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Pages | Assets estáticos sem invocar Functions gratuitos; Functions consomem franquia Workers. | [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/) |
| D1 | Free 5 milhões linhas lidas/dia, 100 mil escritas/dia, 5 GB; Paid 25 bilhões leituras/mês e 50 milhões escritas/mês, excedentes US$0,001/milhão e US$1/milhão; storage extra US$0,75/GB-mês após 5 GB. | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| R2 Standard | 10 GB-mês, 1 milhão A, 10 milhões B incluídos; extra US$0,015/GB-mês, US$4,50/milhão A, US$0,36/milhão B; egress sem tarifa R2. | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |

Divergência nas páginas oficiais: o resumo D1 em Workers pricing mostra storage
extra US$0,20/GB-mês, enquanto a página específica D1 mostra US$0,75. Para planejar,
usar conservadoramente US$0,75 e confirmar na conta/suporte antes de contratar.
Franquias podem ser compartilhadas com outros projetos; R2 arredonda unidades.

**Hipótese de baixo volume, não previsão:** 100 fotos novas/mês × 2 perfis = 200
transformações, mais retries; acervo 500 fotos × (1 MiB original + 2×0,25 MiB)
≈ 0,73 GiB, excluindo versões, quarentena e crescimento; 50 mil requests
dinâmicos/mês, 1 milhão linhas lidas e 10 mil escritas/mês. Se dentro de todas as
franquias e do CPU Free, uso pode ficar em US$0. Se exigir Paid, reservar ao menos
US$5/mês de Workers, mais Images/R2/D1 excedentes. Exemplo isolado: 10.000
transformações únicas/mês no Paid implica US$2,50 além das 5.000 incluídas.
Essa hipótese não comprova elegibilidade, CPU suficiente nem custo final da conta.

Riscos: scans D1 sem índice; retenção infinita de versões/mídia; reprocessamento
por acesso em vez de derivado persistido; tráfego abusivo; retries e objetos órfãos;
mudanças de plano/preço. Medir consumo real e aprovar teto/alertas antes de produção.

## Staging separado de produção

Separar projeto Pages, Worker/binding de mídia, banco D1, buckets R2 de quarentena
e derivados, namespaces/IDs, domínios/origens/cookies, sessões, administrador,
secrets, cache e observabilidade. Preview nunca recebe banco/bucket/secrets prod.
Usar fixtures, não cópia de dados pessoais/sessões. Não inferir isolamento Images:
confirmar escopo de conta/IDs e permissões; separar contas se necessário.
Configuração por ambiente deve ser explícita e validada antes de deploy.
Nenhum desses recursos ou bindings foi criado nesta entrega.

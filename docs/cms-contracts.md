# L0A.2 — contratos CMS e persistência conceitual

Entrega local de 15/10/2026. Base `integration/delegas-f3`,
`f062e7eaf8bfa8c15b5aa48b03e541b66bf1de0b`. Branch, HEAD, staging vazio e árvore
limpa foram confirmados antes da primeira escrita. Nenhuma migration CMS, endpoint,
editor, upload ou publicação funcional foi implementado.

## Inspeção e decisões

Inspecionados: `shared/catalog.ts`, validação/repositório v2, contratos legados,
`readPatchBody`, `requireAdmin`, `adminWriteProof`, migrations 0001–0005, configuração
Pages/D1, fallback `/api/`, contatos/âncoras e gates de release L0A.1.
O catálogo continua sendo a fonte independente de itens, variantes e preços.
CMS guarda somente conteúdo editorial. Não há alteração em F2/F3 ou no frontend.

Os detalhes abaixo concretizam as decisões técnicas para auditoria L0A.2. A árvore
base não contém uma especificação F4A adicional; não se atribui aprovação anterior
a nomes de campos, limites, IDs ou templates novos deste pacote.

## Documento v1

Tipos em `shared/cms.ts`; validação pura em `server/cms/validation.ts`.
Raiz exata: `{ schemaVersion: 1, commercial, modules }`.
Commercial exato: `{ fulfillmentMode: 'delivery', whatsappNumber }`.
Módulos têm `id`, `template`, `region`, `visible`, `navigation`, `content`.
Campos desconhecidos são recusados em todos os níveis, inclusive listas e mídia.
O parser retorna cópia JSON independente, sem corrigir silenciosamente o documento.

| Template | ID | Região | Cardinalidade | Navegação permitida | Âncora do código |
| --- | --- | --- | --- | --- | --- |
| hero | `hero` | start | exatamente 1, visível | none | inicio |
| catalog | `catalog` | catalog | exatamente 1, visível | primary | chopes |
| contact | `contact` | end | exatamente 1, visível | cta | contato |
| ticker | `module_<UUIDv4>` | intro | 0–1 | none | nenhuma |
| about | `module_<UUIDv4>` | details | 0–1 | none | nenhuma |
| barrels | `module_<UUIDv4>` | details | 0–1 | none ou primary | barris |
| how | `module_<UUIDv4>` | details | 0–1 | none ou primary | como |
| faq | `module_<UUIDv4>` | details | 0–1 | none ou primary | faq |
| highlight | `module_<UUIDv4>` | details | 0–3 | none | nenhuma |

Ordem do array é a ordem de composição. Regiões são monotônicas:
start → intro → catalog → details → end. Opcionais podem ser reordenados dentro
da própria região; não podem atravessar o catálogo, o Hero ou o contato.
IDs sobrevivem a edição/reordenação/ocultação; novo módulo ganha novo UUID.
Unicidade inclui módulos ocultos. Limites de repetição contam módulos ocultos.
Ocultar retira da projeção e da navegação; não remove referência persistida.
Não existe campo para editar âncora, href, CSS, HTML, script ou URL de mídia.
Links do header para módulos ausentes/ocultos deverão ser omitidos pelo futuro renderer.
`barris`, `como`, `faq` e `chopes` preservam as âncoras atuais do site.

Hero: heading/summary/media. Catálogo: heading/intro. Contato: heading/body.
About/barrels/highlight: heading/body/media. How: heading/steps(title/body).
FAQ: heading/items(question/answer). Ticker: items de texto.
Mídia é `{ id: 'media_<UUIDv4>', alt }` ou null onde permitido.
Não há dados de produto, preço, promoção automática, tema arbitrário ou editor genérico.

Limites: documento serializado até 65.536 bytes UTF-8; teto defensivo 24 módulos
(as cardinalidades v1 permitem no máximo 11); heading/questão/step title/ticker
até 120 pontos Unicode; textos até 2.000; alt até 200; listas até 12 itens.
Versões futuras exigem parser explícito, sem downgrade/fallback implícito.

## Rascunho, publicação e regras comerciais

Rascunho aceita null em WhatsApp, texto vazio e Hero sem mídia. Estrutura, tamanhos,
tipos, unicidade, regiões, segurança de texto e regras comerciais já são obrigatórios.
Publicação exige WhatsApp canônico de 8–15 dígitos, primeiro não zero, com código
de país; não remove pontuação nem assume Brasil. Essa validação sintática não
comprova titularidade, existência ou atendimento do número. Sem número não publica;
não há fallback para contato compilado, placeholders ou número anterior.

Na publicação, todo campo textual de módulo visível precisa ter conteúdo visível;
listas visíveis não podem estar vazias, Hero precisa de mídia e toda mídia visível
precisa de alt. Opcionais ocultos podem continuar incompletos. Nenhuma referência
de mídia, inclusive oculta, pode estar pendente/rejeitada ao publicar a versão:
`publicationMediaErrors` complementa a validação documental com inventário pronto.
Validador do documento sozinho não verifica existência no armazenamento.

Strings são texto inerte: rejeitam delimitadores de markup, formas de URI/esquema,
controles e Unicode malformado/bidi. Não são interpretadas como HTML, Markdown,
CSS ou JavaScript; o futuro renderer deverá usar nós de texto/props conhecidas,
sem `innerHTML`, eval, style ou fetch derivados do texto. Esse filtro conservador
não é um reconhecedor completo de linguagens/URLs nem garantia de conformidade
comercial. Conteúdo editorial ainda exige revisão humana, inclusive promessas de
entrega, retirada disfarçada, horários, área atendida e taxas. Não há blacklist de
palavras apresentada como controle suficiente.

`AgeNotice`, maioridade, avisos legais, operação delivery e composição dos links
WhatsApp são responsabilidade do código. Não existe opção de desligá-los no CMS.
F4A deve renderizar os avisos fora da lista editorial e gerar todos os links do
único número da versão publicada. O frontend atual permanece intacto nesta etapa.
Nenhum texto comercial de partida ou seed foi criado.

## Estados administrativos, revisão e recibos

`CmsAdminSnapshot` separa draft(revision/document) de published(versionId/revision/
document) ou null. Documento é independente do envelope de operação e da autenticação.
Revisão CMS: `c1_<UUIDv4>` opaco gerado no servidor, não é contador do catálogo.
Operation ID: UUIDv4 canônico, gerado uma vez pelo cliente por intenção de salvar/
publicar, reutilizado na repetição da mesma requisição. IDs não são credenciais.

Envelope exato: `{ action: 'saveDraft' | 'publish', expectedRevision, operationId,
document }`. Publicar grava o documento enviado e a versão pública juntos sob a
mesma precondição. Qualquer mutação aceita troca a revisão do draft; publicar
também troca a referência publicada. Não existe publicação automática ao salvar.
Transportes HTTP futuros devem exigir `If-Match: "c1_<UUIDv4>"` forte único,
igual ao expectedRevision; recusar wildcard, fraco e múltiplos tokens. O parser
HTTP e os endpoints não foram criados. Corpo: limitar fluxo de bytes e tempo antes
de JSON.parse, como no leitor existente; o limite pós-parse não impede alocação prévia.

Futuros códigos: 400 contrato inválido; 401 sessão inválida; 403 origem inválida;
409 revisão divergente/operação reutilizada com outro comando; 413 corpo excessivo;
428 precondição ausente; 503 estado/schema/armazenamento indisponível. Erros sem
SQL, tokens ou chaves R2. Escritas administrativas com no-store.

`projectPublicCms` revalida publicação, copia apenas campos permitidos, retira
ocultos e acrescenta âncoras do código. Não devolve revisão administrativa,
operationId, autor, sessão, objeto de quarentena ou chave R2. Só deve receber um
documento lido do ponteiro publicado; esta função pura não atesta estado persistido.
Referências de mídia continuam IDs; resolução pública futura aceitará apenas ID e
perfil fixo, consultará derivado pronto e não aceitará URL/fetch externo fornecido.

## D1: desenho conceitual, sem DDL/migration executável

| Tabela proposta | Conteúdo e restrições a implementar em F4A |
| --- | --- |
| cms_state | Uma linha por site: draft_version_id, draft_revision, published_version_id nullable, published_revision nullable. FKs para versões imutáveis; par publicado inteiro ou ambos null. |
| cms_versions | version_id PK, site_id, schema_version, kind draft/published, document_json, expected_revision, resulting_revision, operation_id, command_hash, actor_id, created_at e recibo da operação. UNIQUE(site_id, operation_id), revisions únicas. Linhas aceitas imutáveis. |
| cms_media | media_id PK, estado, chaves internas de quarentena/derivados, hashes, dimensões/bytes, perfil/versão do encoder, timestamps, tentativa/lease e erro interno limitado. Derivados ready imutáveis. |
| cms_media_refs | PK(version_id, media_id), FKs RESTRICT para versão/mídia, índice reverso media_id/version_id. Inclui referências de módulos ocultos. Sem ref por URL ou contagem manual isolada. |

Retenção de versões determina retenção de mídia. Último rascunho e publicado não
podem ser removidos; versões históricas mantidas pinam seus objetos. Documentos
incompletos podem referenciar mídia existente em processamento no rascunho; IDs
inexistentes devem falhar por FK. Publicação exige todos os derivados ready.
Tabela de catálogo e seu revision não participam desta transação.

### Mutação autorizada, concorrência e idempotência

1. `requireAdmin` verifica sessão/origem. Não basta essa leitura para autorizar SQL.
2. Calcular hash de comando normalizado (ação, expectedRevision, documento com
   ordem canônica de chaves, ordem dos arrays preservada); incluir site e identidade
   no escopo. Não usar o JSON de ordem arbitrária nem tratar hash como autorização.
3. Uma transação D1 deve reavaliar `adminWriteProof` (sessão ativa, origem, expiração,
   versão de autenticação) junto da escrita/recibo. Nunca interpolar parâmetros.
4. Procurar operationId sob autorização vigente antes de testar revisão. Mesmo ator
   e mesmo hash: devolver recibo original, inclusive após nova revisão. Outro ator
   ou outro hash: conflito sem expor documento/recibo. Revogação impede replay.
5. Operação nova: CAS de draft_revision esperado; criar versão imutável/recibo,
   inserir refs, validar estado de toda mídia e trocar ponteiro(s) no mesmo commit.
   Exigir uma linha de CAS e todas as pós-condições. Zero linhas não é sucesso.
6. Falha de autorização, revisão, FK, mídia ou pós-condição deve abortar tudo,
   inclusive recibo. Não salvar versão/ref sem avançar o estado. Sem retry cego
   após conflito: cliente lê snapshot e resolve intenção.

Na implementação, usar comando SQL protegido/triggers/assertivas transacionais,
ou mecanismo equivalente comprovado com testes D1. `db.batch` sozinho não detecta
UPDATE que afetou zero linhas; não montar INSERT incondicional depois de CAS vazio.
O pacote contém só os contratos, não uma prova de atomicidade SQL CMS. Exigir em
F4A testes reais de duas sessões concorrentes, revogação entre guard e escrita,
mesmo operationId concorrente, resposta perdida, referência mudando para deleting
e rollback em cada ponto. Sessão guardada não pode autorizar versão posterior.
Referência: [API batch do D1](https://developers.cloudflare.com/d1/worker-api/d1-database/).

### D1 e R2 não compartilham uma transação

Fluxo planejado: quarantined → processing (lease) → ready ou rejected.
Processing com lease expirada pode ser retomado por CAS. Estado rejected não vira
ready sem nova tentativa validada; novo conteúdo usa novo media_id. Pronto não
permite trocar objeto/hash sob o mesmo ID. `publicationMediaErrors` valida formato
do manifesto e presença dos dois perfis; hashes só são provados ao ler bytes no
processamento/armazenamento, não por comparar strings do manifesto.

Objetos de entrada privados, sem publicação de originais. Derivados WebP em
`cms/derived/<media_id>/<sha256>/<hero|section>.webp`; sha do arquivo reencodificado.
Usar criação condicional sem sobrescrita; colisão exige conferir hash/bytes e
falhar em divergência. Novos parâmetros/encoder geram novos hashes/novo registro,
sem mudar versões publicadas. URLs de entrega são construídas pelo código.

Após gravar R2, validar/confirmar todos os derivados antes de transição ready no D1.
Se D1 falhar depois de R2, restam objetos órfãos: reconciliador identifica objetos
sem registro/ref, aguarda carência e lease e tenta novamente. Se faltar objeto de
registro ready, bloquear nova publicação, alertar e reconstruir de origem válida
sem devolver original como fallback. Definir carência/retentiva antes de produção.

GC: selecionar mídia sem refs de QUALQUER versão retida e sem lease/upload ativo;
marcar deleting por CAS no D1 com nova checagem de refs. Publicação passa a recusá-la;
apagar R2 idempotentemente; marcar deleted só após confirmação. Crash entre passos
é retomável. Não usar somente idade/listagem do bucket para decidir exclusão.
Não executar GC contra objetos publicados, rascunhos ou tentativas em andamento.

## Escopo de próxima fase e auditoria

Recomendação inicial: GO condicionado para F4A.1 de contratos/persistência local,
após auditoria independente Antigravity deste pacote. Não é GO de upload, deploy,
criação remota, migração mantida ou CMS funcional completo. Se F4A.1 incluir upload
em produção, NO-GO até prova remota autorizada e lacunas de mídia resolvidas.
Ver [mídia, custos e experimento pendente](cms-media-proof.md) e
[resultados locais](l0a2-validation.md).

Pendências de decisão: confirmar nomes/templates/regiões da tabela no desenho F4A;
confirmar WhatsApp/conteúdo comercial; aprovar limite de fotos, carência/retentiva,
mínimos de resolução/qualidade/crop e estratégia de falha; escolher processamento
remoto após experimento e conferir preços efetivos da conta. Nenhum botão de
publicação pode antecipar essas decisões operacionais.

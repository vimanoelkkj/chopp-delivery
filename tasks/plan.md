# F3A.2 — expansão do catálogo

Status em 14/10/2026: implementação LOCAL autorizada explicitamente pelo usuário.
Alternativa A implementada: migration única 0005, sem espelho/0006, APIs v2 e
consumidor público. Contrato definitivo e operação: [catalog-expansion.md](../docs/catalog-expansion.md).
Os PoCs abaixo permanecem como histórico; as regressões do código definitivo e os
gates são registrados no [todo.md](todo.md). F3B/formulário continuam sem autorização.
Base: `fbea7640f090aa46b34260bb135a750a58fa0f0a`; branch `feat/catalog-expansion`.
F3A.1 consolidada com a mensagem `chopp-delivery: add atomic admin catalog saves`.
Referência F3B, somente leitura: `0808d2e799490aa80b0a2eba2d5ac0198afe930b`.

## 1. Evidências e limites

Foram inspecionados os schemas/migrations 0001–0004, handlers públicos e administrativos,
`adminWriteProof`, os testes D1 e os contratos reais da F3B (types, gateway, draft,
useCatalogEditor, ProductRow e a máscara monetária). O schema atual tem oito chopes,
duas colunas de preço por chope e cachaça singleton. Os dados efetivos da migração
virão das tabelas, nunca do seed ou dos mocks; as quantidades atuais não serão hardcoded.

A F3B tem duas abas fixas, slots 30/50/bottle e mapas de rascunho por ID. Já trabalha
com listas de cachaças, mas não cadastra itens, não edita nome/descrição e não representa
variações arbitrárias. `changedIds` ignora itens que não existam no snapshot salvo.
Logo, um adaptador sozinho não resolve o novo requisito de cadastro/variações.

O Delegas ainda não está publicado e não há requisito de disponibilidade contínua
durante a migração. Isso elimina a necessidade operacional que motivava o espelho.
Foram executados PoCs autorizados com Wrangler/D1 estritamente locais e descartáveis;
evidências, escopo e limitações estão na seção 9.
Na consolidação anterior, os 339 testes existentes foram repetidos antes do commit
e passaram, assim como
typecheck e Biome. Backend 307/307 e Chrome 39/39 são evidências da entrega/revisão
anterior do mesmo conteúdo; não foram reexecutados nesta consolidação.

## 2. Comparação e recomendação do modelo

| Alternativa | Avaliação |
|---|---|
| Remover singleton e acrescentar colunas por tamanho | Menor mudança imediata; cada nova variação exige schema/handler específico. Não atende bem categorias/variações futuras. |
| Manter entidades separadas com uma tabela de variantes para cada tipo | Atende agora, duplica validação, ordenação, transação e futuras integrações. |
| Categorias + itens + variantes relacionais | Recomendada: identidade global, múltiplas cachaças e quantidades de variantes sem novas colunas comerciais. |
| Atributos EAV, configurações JSON arbitrárias ou construtor de categorias | Complexidade desnecessária; não propostos. |

Os nomes catalog_categories/catalog_items/catalog_variants são adequados ao domínio;
não impõem frameworks, ORM, estoque, SKU, impostos ou subsistemas novos.

### Schema lógico proposto

Todas as tabelas novas são STRICT. Valores booleanos são INTEGER 0/1; preços,
ordens e volumes são inteiros validados. IDs persistentes continuam strings.

| Tabela | Colunas e restrições principais |
|---|---|
| catalog_categories | id TEXT PK; name TEXT NOT NULL; sort_order INTEGER NOT NULL entre 0 e 2147483647 |
| catalog_items | id TEXT PK global; category_id TEXT NOT NULL FK categories(id) ON DELETE RESTRICT; name, description TEXT NOT NULL; visible INTEGER 0/1; sort_order INTEGER no mesmo intervalo; creation_ref TEXT nullable UNIQUE |
| catalog_variants | item_id TEXT NOT NULL FK items(id) ON DELETE RESTRICT; code TEXT NOT NULL; label TEXT NOT NULL; volume_ml INTEGER nullable positivo/seguro; price_cents INTEGER nullable entre 1 e 9999999; sort_order INTEGER no mesmo intervalo; creation_ref TEXT nullable UNIQUE global; PK(item_id, code) |
| catalog_meta | Preservada da 0004: mesma linha singleton e contador. Não adicionar coluna de negócio ou usar o contador como recibo de operação. |

Índices para leituras: items(category_id, sort_order, id) e
variants(item_id, sort_order, code). Não exigir unicidade de nome/posição/volume:
nomes podem repetir, posições antigas podem empatar e embalagens diferentes podem
ter o mesmo volume. Code identifica a variação comercial dentro de um item.

Inicialmente categories contém chopes e cachacas, nessa ordem. Só haverá cadastro
de itens em categorias existentes. Sem editor, hierarquia, filtros ou cadastro
de categorias nesta fase: a relação permite acrescentá-las no futuro com contrato
e apresentação aprovados. A categoria de um item existente não será alterável agora.

### Semântica comercial

- Cada tamanho existente terá uma linha de variante, mesmo quando price_cents é null.
  Null continua significando tamanho não comercializado, sem relação com estoque.
  Ausência da linha significa variante não definida, não preço zero.
- Oito chopes preservam os codes legados `30` e `50`, volumes 30000/50000 ml e ordem
  0/1. Esses codes mantêm seus volumes, para não redefinir silenciosamente 30/50 L.
- Cachaça atual preserva code `bottle`, volume do banco (atualmente 700 ml) e preço.
  Um novo item de cachaça pode ter suas próprias variantes/volumes e não tem singleton.
- Regra inicial preservada: cada variante definida de cachaça exige preço positivo;
  barris podem ter preço null. Item visível exige ao menos uma variante com preço.
  Regras entre tabelas serão verificadas no estado final pelo comando SQL, além da API.
- Todo item, novo ou existente, exige pelo menos uma variante definida, mesmo oculto.
  Chope oculto pode ter todas as variantes com preço null. Chope visível não pode.
  Cachaça não aceita variante com preço null, mesmo oculta. Item novo sem variantes,
  variante sem campo priceCents ou preço zero são 400; null explícito só nas regras
  permitidas. A validação SQL final deve impedir que uma escrita ignorada deixe
  itens sem variantes; não basta validar o JSON antes da transação.
- Variantes futuras usam code imutável gerado pelo servidor, label legível e volume
  quando aplicável. Não há atributos arbitrários ou conversão de moeda por float.
  Chopes e cachaças exigem volume positivo inteiro em ml; volume null fica reservado
  a categorias futuras cuja unidade comercial não seja volumétrica.
- Não haverá exclusão de itens/variantes persistidos por omissão no PUT. Ocultar um
  item é a operação disponível; barris não vendidos mantêm variante com preço null.
  Um item temporário pode ser removido do rascunho antes de seu primeiro salvamento.

### Mapeamento de dados existentes

| Origem | Destino |
|---|---|
| products.id/name/description/visible/sort_order | Item na categoria chopes, com os mesmos valores e ID |
| products.price_30_cents, price_50_cents | Variantes 30/50, centavos e null exatamente iguais |
| cachaca.id/title/description/visible | Item em cachacas; title vira name; sort_order inicial 0 |
| cachaca.bottle_ml/price_cents | Variante bottle com volume e centavos exatamente iguais |
| catalog_meta.revision = N | Mesmo N durante expansão/backfill; sem reset |

creation_ref será NULL nos registros migrados. Colisão de IDs entre as tabelas de
origem, preços incompatíveis, texto inválido ou referência órfã abortam a migração:
não prefixar IDs antigos, arredondar valores ou corrigir dados silenciosamente.

## 3. Comparação A/B e caminho escolhido

| Critério | A — 0005 única, janela sem escritores | B — 0005 com espelho, 0006 de corte |
|---|---|---|
| Complexidade | Uma migração de dados/corte e uma ativação coordenada; sem sincronização | Duas migrations, escritor antigo + espelho transitório, pós-condições por operação e retirada posterior |
| Fonte de verdade | Unificada após o corte; origens congeladas servem só como arquivo | Antiga durante o espelho; nova após segundo corte; exige comprovar equivalência continuamente |
| Reversibilidade | Falha antes do commit reverte a 0005; backup permite retorno antes de novas escritas | Permite permanecer na fase antiga por mais tempo; depois de novos cadastros tem a mesma limitação de retorno de A |
| Falha parcial | Assertivas SQL e atomicidade do arquivo; schema parcial externo continua inválido | Mesmas exigências por arquivo, mais estado intermediário e risco de espelho incompleto/IGNORE |
| Wrangler/D1 | PoCs comprovaram DDL, cópia, corte e histórico revertidos juntos no runtime local atual | Não é uma exigência da plataforma; cada fase ainda precisa dos mesmos testes, além dos testes do espelho |
| Testes | Cópia, EXCEPT bidirecional, quatro pontos de falha, histórico, reaplicação, bloqueio legado e recuperação | Todos os anteriores + I/U/D/no-op do espelho, destinos ausentes, falhas/IGNORE, coerência de leitores e segundo corte |
| Necessidade operacional | Satisfaz o estágio não publicado com janela sem escritores | Útil se for exigido continuar editando/servindo durante uma transição em etapas; requisito ausente |

**Escolha: A.** Não criar espelhamento nem reservar uma 0006 de corte nesta fase.
Os PoCs sustentam o mecanismo da 0005 única; não certificam uma migration de produção
que ainda será escrita e deverá ter testes próprios. B só será reconsiderada se surgir
um requisito operacional real de transição contínua, com nova decisão explícita.

### Sequência definitiva da 0005 proposta

1. Fechar a janela de escrita: parar backends locais/versões antigas e quaisquer
   scripts que escrevam; obter snapshot consistente do banco parado, manifesto de
   schema e revisão N. Não aplicar com dois escritores ativos. Nesta etapa não há deploy.
2. Validar estado 0004, linha única de catalog_meta, IDs e dados de origem. Criar as
   três tabelas/índices/categorias e copiar os valores efetivamente persistidos.
   Pais antes de filhos; não executar seed nem mascarar falhas com IF NOT EXISTS
   ou ON CONFLICT DO NOTHING. Dados incompatíveis exigem decisão, não reparação implícita.
3. Conferir equivalência bidirecional de itens e variantes por EXCEPT, incluindo
   IDs, descrição, centavos, nulls, volume, visibilidade e ordem; verificar FK e
   cardinalidades derivadas da origem. Assertiva SQL deve abortar em divergência.
4. Retirar catalog_save e seu trigger e os seis triggers de revisão antigos.
   Bloquear I/U/D em products/cachaca com erro SQL fixo. As origens ficam congeladas
   para referência; não são fallback nem fonte consultada pelos handlers novos.
5. Instalar triggers I/U/D de revisão nas tabelas novas, após o backfill, ignorando
   UPDATEs idênticos e abortando com metadata ausente/overflow. Instalar o comando
   unificado condicionado por revisão + adminWriteProof e pós-condições SQL.
6. Preservar a linha/tabela catalog_meta e avançar a revisão no corte para invalidar
   snapshots do formato anterior. Não zerar N. O avanço único nesse corte é uma
   escolha de migração, não uma promessa de incremento unitário por salvamento.
7. Validar o schema final e registrar a aplicação pelo Wrangler. Só abrir escritores
   v2 após verificar histórico, objetos esperados, integridade, backend/consumidores
   compatíveis e gates. Nenhum PATCH/PUT legado permanece capaz de escrever.

Dados, DDL, congelamento e avanço da revisão devem compor a mesma execução transacional.
Na versão inspecionada, Wrangler buildMigrationQuery acrescenta o INSERT do histórico
à SQL da migration; o PoC também injetou falha nesse INSERT e comprovou rollback total.
Esse resultado é local e específico das versões testadas; revalidar ao atualizar ferramentas.
Não adicionar BEGIN/COMMIT manuais ou dividir a 0005 em execuções independentes.

### Aplicação única e recuperação de falhas

- O gate de prontidão exige d1_migrations da 0005 **e** tabelas/colunas/índices/triggers/
  comando/congelamento esperados, metadata válida e foreign_key_check limpo.
  Um objeto isolado ou uma linha de histórico não torna schema parcial válido.
  GET novo e escrita devem falhar fechados (503) se o gate não estiver completo.
- Nos PoCs de falha normal do Wrangler, o estado anterior foi restaurado por inteiro,
  sem registro 0005; removida a causa injetada, reaplicar funcionou. No produto,
  corrigir uma migration ainda não aplicada e repetir exige antes confirmar esse estado.
- Se houver estado parcial preexistente por execução manual/interrupção fora desse
  mecanismo: manter tudo fechado, preservar evidências e restaurar snapshot validado
  do estado 0004, depois reaplicar a 0005 e conferir tudo novamente. O PoC provou
  esse caminho com uma cópia local consistente em outro diretório, sem apagar a evidência.
  Sem backup válido, parar e preparar remediação explícita; não tentar completar
  automaticamente com IF NOT EXISTS, apagar histórico ou tratar a origem como fallback.
- Se 0005 já estiver registrada, não editar seu arquivo: uma inconsistência exige
  correção forward aprovada ou restauração coordenada. Não fazer seed por cima.
- Antes de liberar novas escritas, backup 0004 permite retorno ao conjunto antigo
  de código/schema. Depois de novos cadastros, não há down sem perda para singleton/
  slots antigos. Preferir correção forward; restauração pode perder alterações e
  precisa de autorização, invalidação de sessões/rascunhos e revisão do que será perdido.
- Não desabilitar foreign_keys. O backfill ordenado não precisou adiamento nos PoCs.
  Reaplicação normal deve informar nenhuma migration pendente e preservar dados/revisão.

## 4. Contratos HTTP propostos

### Administração: GET/PUT /api/admin/catalog/v2

Versionar evita alterar silenciosamente o snapshot aprovado da F3A.1. GET devolve
revision + categories ordenadas; cada categoria contém items ordenados; cada item
contém variants ordenadas. Inclusive ocultos e preços null. Centavos em todas as APIs v2.

Exemplo parcial de GET (o PUT envia o catálogo completo):

```json
{
  "revision": "r42",
  "categories": [{
    "id": "chopes", "name": "Chopes", "items": [{
      "id": "dronken", "creationRef": null,
      "name": "Dronken", "description": "Double Double", "visible": true,
      "variants": [{
        "code": "30", "creationRef": null, "label": "Barril de 30 L",
        "volumeMl": 30000, "priceCents": 51000
      }]
    }]
  }]
}
```

Categorias são existentes e completas; nomes de categoria são somente leitura.
PUT mantém revision no corpo e If-Match forte no formato aprovado. Arrays determinam
a ordem. Normalizar para 0..n-1 apenas quando a sequência efetivamente mudar;
preservar posições antigas empatadas/esparsas em no-op. IDs/codes existentes não mudam.

Entradas de item são uma união exclusiva: `{id, ...campos}` para persistido ou
`{clientId: "tmp:<UUID>", ...campos}` para novo, nunca ambos. Variante segue a mesma
distinção com code persistido ou clientId temporário. creationRef é somente leitura
e não pode ser alterada via PUT; o adaptador remove esse metadata da entrada.
Nome/descrição/visibilidade e variantes comerciais são editáveis dentro das regras
acima. Campos extras, tipos incorretos, omissões de persistidos e referências
cruzadas são 400, identificando campo e referência do rascunho.

Omissão de variantes persistentes é proibida, inclusive se o item estiver oculto ou
o preço for null. Antes das mutações, no próprio comando SQL, exigir igualdade do
conjunto de pares persistidos (itemId, code) com os pares marcados como existentes
no pedido: EXCEPT em ambas as direções, rejeição de duplicatas e conferência do pai.
Itens e categorias persistidos também precisam estar completos. Novos clientIds
não podem substituir variantes existentes. Depois das mutações, verificar a união
do conjunto anterior com os IDs/codes novos esperados, todos os valores e a presença
de variantes em cada item. Qualquer falha aborta tudo, sem DELETE por omissão e sem
depender apenas de validação JavaScript ou de row counts. PoCs rejeitaram a omissão
de variante com preço null e de variante de item oculto, revertendo escrita anterior.

Cada item novo recebe ID definitivo `item_<UUID>` gerado pelo servidor. Variantes
novas recebem code `v_<UUID>`, com unicidade por item. O servidor constrói o mapa
antes da batch, mas não o confirma fora da transação. No banco, creation_ref retém
o clientId canônico completo (`tmp:<UUID>`), imutável e único; não é credencial ou
dado público. O cliente compara a mesma representação exata devolvida em creationRef.
Para novo item de cachaça, o formulário não depende do literal bottle: usa a lista
de variantes, inclusive volume e preço obrigatório.
IDs legados não precisam ter formato UUID. A distinção usa os campos id/clientId,
não uma tentativa de inferir o tipo apenas pelo prefixo de uma string. Identidades
de rascunho devem ser marcadas como persistidas/temporárias e variantes são sempre
referenciadas junto do item pai. Cadastros entram apenas pelo PUT transacional,
com INSERTs parametrizados; nunca alterando ou reexecutando o seed.

PUT 200 retorna `{catalog: <snapshot>, created: {items: [{clientId,id}], variants:
[{itemId,clientId,code}]}}`. O gateway retorna o snapshot salvo e aplica os mapas
ao rascunho de forma indivisível, sem preservar referências temporárias obsoletas.

Erro: `{error:{code,message,fields?}}`, sem SQL/segredos/valores enviados em logs.
Mantém 401 sessão, 403 CSRF, 409 conflito, 428 If-Match ausente, 503 infraestrutura;
400 para validação/If-Match malformado e 405 para métodos não suportados. No-store,
mesma origem e demais headers de segurança existentes.

### Retry e resposta perdida

Uma tentativa mantém a mesma revisão base e os mesmos clientIds em todos os retries.
Repetição após commit efetivo recebe 409 antes de qualquer INSERT, não um novo cadastro.
GET posterior devolve IDs definitivos e creationRef: o adaptador consegue localizar a
criação sem comparar nomes/preços ou adivinhar qual item foi criado.

**Essa recuperação depende de o cliente preservar os clientIds.** Gerar uma vez ao
adicionar a linha e manter no rascunho até confirmação/descarte. Antes do fetch,
preservar um registro pendente com revisão base e refs de itens/variantes por pai,
em sessionStorage separado por origem/usuário, para sobreviver a reload da mesma aba.
Não armazenar senha, cookie ou token; limpar ao concluir, descartar ou sair da conta.
Durante resultado incerto, bloquear um novo salvamento até consultar/reconciliar o
servidor. sessionStorage não garante recuperação após fechar a aba, limpar armazenamento
ou perder o clientId: nesse caso, recarregar e revisar o catálogo; não recriar refs e
reenviar automaticamente, nem tentar identificar o cadastro por nome/preço.

Não atualizar a revisão de um pedido incerto e reenviar suas criações automaticamente.
Após conflito, manter a política existente de bloquear salvar até recarregar. Se um
clientId já persistido reaparecer como novo com uma base atual, recusar como validação
em vez de sobrescrever ou criar outra linha. Outra intenção exige outro clientId.
Race/violação de unicidade aborta o salvamento inteiro. Sem tabela de recibos/TTL ou
promessa de replay 200: esta é recuperação por conflito + consulta autenticada.

### Público: GET /api/catalog

Retorna o mesmo agrupamento de categorias/itens/variantes com revision, apenas itens
visíveis, sem creationRef. Todos os produtos/cachaças comerciais são representados;
preços permanecem centavos e variantes null são preservadas como não vendidas.
Categorias sem itens visíveis podem ser omitidas, sem omitir produtos visíveis.
Não usar allowlist de categoria/code 30/50/bottle para filtrar dados nem LIMIT
silencioso. Toda variante definida de cada item visível deve sair no DTO, inclusive
null ou code futuro. A leitura deve preservar itens sem perder linhas por INNER JOIN;
se encontrar estado inválido (por exemplo, item sem variantes), devolver 503 genérico
para o snapshot inteiro, nunca 200 parcial. O frontend deve apresentar o contrato
completo ou falhar explicitamente, sem esconder categorias/variantes desconhecidas.

| Estratégia | Consequência |
|---|---|
| Manter só products + cachaca singular | Não representa uma segunda cachaça; teria de bloquear a expansão ou perder informação. |
| Acrescentar cachacas e manter uma cachaca escolhida | Cliente antigo continua vendo uma só; rejeitada por esconder produtos/arbitrar seleção. |
| Contrato público novo + migração controlada | Recomendada: representação completa e evolução explícita do storefront. |

Na ativação coordenada da 0005, o frontend passa a /api/catalog, ainda com os nove itens atuais. Seu
adaptador valida centavos e usa conversão exata ao reutilizar os componentes atuais;
o banner atual pode renderizar uma lista de cachaças, mantendo a aparência do caso
de uma única garrafa. Variantes e futuras categorias exigem apresentação explícita;
não filtrar silenciosamente os tipos desconhecidos.

GET /api/products continua com o formato legado enquanto o estado público inteiro
for representável: chopes 30/50 e no máximo uma cachaça com uma variante. Se o estado
deixar de caber, responde 409 CATALOG_REQUIRES_NEW_CLIENT, sem devolver uma seleção
parcial. Isso significa que clientes antigos não podem permanecer suportados
indefinidamente depois da expansão. A liberação exige aprovar a migração dos clientes;
o storefront servido deve estar na versão nova antes de publicar novos formatos.

O mesmo limite se aplica ao PUT administrativo legado: uma projeção incompleta não
pode substituir o catálogo novo. **Decisão: aposentar todas as escritas administrativas
v1 no corte**, incluindo PATCHs sem If-Match e PUT antigo. Após guard de autenticação/
CSRF, responder 410 ENDPOINT_RETIRED ao cliente autorizado; não encaminhar a escrita
para adaptadores sem precondição. Só PUT v2 escreve com revisão e prova SQL. Assim,
401/403 continuam fechando acesso e os contratos 409/428/503 permanecem na API v2.
As leituras legadas podem projetar a fonte nova apenas quando integralmente
representável, com recusa explícita de incompatibilidade. Nunca consultar o arquivo
antigo para produzir uma resposta aparentemente válida. Aposentadoria das escritas,
testada também via HTTP, é gate bloqueante antes de qualquer deploy futuro.

## 5. Atomicidade, autorização e custo

### Estratégia recomendada inicialmente

Manter o padrão aprovado da F3A.1, generalizando a view de comando para itens/variantes.
Um único UPDATE parametrizado admite o comando por revisão + adminWriteProof no WHERE.
O trigger realiza as criações e edições, valida o estado completo e aborta em falha.
Categorias não recebem mutações arbitrárias nessa fase. Uma batch inclui o comando
e os SELECTs do snapshot posterior; GET também é somente leitura transacional.

Fluxo: guard HTTP/CSRF → leitura limitada/JSON estrito → validação e geração de IDs →
UPDATE condicionado → conferência SQL de identidades/refs/valores/ordem/invariantes →
snapshot/revisão → resposta. Falha em qualquer SQL reverte dados, creationRefs e revisão.
No-op não dispara UPDATEs efetivos. Guard ausente/expirado na admissão não gera cadastro.
Logout/revogação antes da operação bloqueia; commit confirmado antes de logout permanece.

RETURNING é recibo de admissão, não a revisão final de triggers. Sessão/origem/usuário
ativo/auth_version/expiração continuam reavaliados em SQL. A autoria e a comparação
da revisão não são SELECTs separados seguidos de mutações sem prova.

### Investigação da proposta de guard + statements

É viável **somente** com uma guarda que lance erro SQL quando rejeitada. Uma guarda
que retorna false/zero linhas permite que o restante da batch prossiga. Conferir
changes em JavaScript depois não pode desfazer o commit; withSession também não
substitui uma transação. Não usar um save_guard compartilhado persistido entre requests.

Alternativa experimentada: INSERT incondicional em view de guarda com INSTEAD OF trigger
e RAISE(ABORT) fixo para falta de metadata, sessão inválida ou revisão divergente,
seguido de mutações parametrizadas e verificador final que também aborte em SQL.
A guarda não pode deixar de ser chamada porque o SELECT de origem produziu zero linhas.
Além disso, um relógio de expiração não é congelado pela batch inteira: repetir prova
nas mutações e no verificador final, com rollback se alguma escrita tiver sido omitida.
Não comparar cada mutação com a revisão base: os próprios triggers já a terão avançado.

Essa alternativa evita um trigger de comando maior, mas aumenta quantidade de statements,
amarração dos helpers e caminhos de recusa. O PoC passou com guarda inicial que aborte,
prova nas mutações, guarda final de sessão e pós-condição SQL: sete statements para o
mesmo exemplo de criação/edição. Detectou inclusive expiração real entre statements
(prazo de 10 ms armado pelo instrumento de teste, seguido de consulta deliberadamente
lenta), revertendo tudo. Não é uma falha do D1; é uma exigência do protocolo de guarda.

**Escolha: manter comando único**, que também passou nos PoCs, reutiliza a estratégia
aprovada e reúne admissão/mutações no mesmo statement. A comparação não demonstra que
guarda + statements seja insegura em qualquer forma; demonstra que a versão completa
tem mais obrigações e não traz uma necessidade atual que justifique trocar o mecanismo.
Os protótipos são pequenos, não implementam o contrato v2 inteiro e não substituem
os testes de integração da implementação futura.

Limitar corpo, itens/variantes/textos, tempo de leitura e custos antes de gerar statements.
**Propostas ainda não aprovadas como orçamento:** 128 KiB, 128 itens, 8 variantes por
item e 512 variantes totais. PoCs desta rodada não mediram a capacidade nesses tetos.
Testar payload UTF-8 real, descrições, JSON, auth + queries, latência/CPU e rollback;
ajustar os números pela evidência e aprovar antes de fixá-los. O limite total de bytes
pode ser atingido antes dos limites por registro. Limites de escrita não autorizam
truncar GET ou omitir dados. Comandos set-based/JSON evitam
uma query externa por linha. A documentação atual limita queries por invocação e
parâmetros por statement; a implementação deve contar o orçamento completo de
autenticação + batch, sem dividir o salvamento em várias batches para caber.

## 6. Impacto na F3B e sequência de execução

Não alterar o worktree do Claude durante esta tarefa. Após aprovação, integrar de
forma coordenada em branch própria; o commit 0808d2e é referência, não cherry-pick autorizado.

- Gateway: conservar load(signal)/save e AdminApiError; tipos passam a categorias,
  itens e variantes. save terá entrada própria e consumirá envelope/catalog/mapas.
  A implementação não fará PATCHs individuais para simular salvamento completo.
- Draft: adicionar name/description, categoria de novos itens, variantes e identidades
  temporárias. changedIds/buildCatalog precisam incluir itens novos, hoje ignorados.
  Chaves de foco/erros/preços usam identidade de rascunho + variante, sem colisões.
- Formulário: cadastrar chope/cachaça, adicionar variação com label/volume/preço e
  cancelar apenas linhas ainda temporárias. Escolha de categoria usa as existentes;
  não incluir editor de categorias, exclusão persistente ou upload.
- Validação: reutilizar máscara monetária de 0808d2e; texto só vira centavos no envio.
  Preservar regras de preço positivo/teto/null, Unicode e item visível com preço.
  Volume usa inteiro em ml, com entrada de litros convertida decimalmente se houver.
- Conflito/401: manter modal, bloqueio de salvar, descartar/recarregar e encerramento
  de sessão. Preservar refs/journal pendente conforme seção 4; não reaplicar
  automaticamente criações incertas após atualizar revision ou perder clientIds.
- Storefront: migrar types/api/useCatalog e consumidores da cachaça singular antes
  da liberação comercial. Mesmos dados atuais devem produzir o mesmo visual/preços.

Tarefas com dependências, arquivos prováveis, critérios e checkpoints estão em
[todo.md](todo.md). Primeiro provar transação/migração; depois leitores e escritores;
então integrar formulários. Nenhum item dessa lista está autorizado para execução agora.

## 7. Matriz de testes a implementar após aprovação

| Área | Casos obrigatórios |
|---|---|
| Migração | Banco 0004 vazio, seed atual e catálogo editado; IDs/names/nulls/centavos/volume/ordem idênticos; N preservada no backfill e avançada no corte; colisão de IDs; dados incompatíveis; schema parcial; falhas em DDL/backfill/retirada/revisão/histórico; reaplicação; FK/índices; restauração validada; bloqueio legado I/U/D e HTTP |
| Cadastro | Novo chope e múltiplas cachaças no mesmo save com edição existente; IDs servidor; variantes únicas; refs duplicadas; referência de variante de outro item; categoria desconhecida; volume inválido; campo extra; item novo sem variantes; persistidos omitidos, inclusive variantes null/ocultas; payload/tempo/tetos |
| Dinheiro/texto | 1, 29, 49099 e 9999999 centavos; zero/negativos/fracionários/NaN/Infinity; UTF-8 inválido/surrogates/bidi/invisíveis; null correto; cachaça sem preço; visível sem variantes vendidas |
| Autorização | Ausente, inválida, expirada, logout, usuário inativo, auth_version, origem, revogação entre HTTP/SQL; CSRF; métodos; mesma prova em todas as rotas de escrita |
| Concorrência | Duas sessões com mesma base criando/alterando: um 200 e um 409; PATCH legado aposentado não grava nem avança revisão; mutações efetivas nas tabelas novas invalidam revisão; no-op não avança |
| Rollback | Falha no quinto item, no primeiro/último INSERT e numa variante; trigger IGNORE; erro em SELECT final; metadata ausente/overflow; nenhuma linha/ref/revisão parcial; guard zero linhas não abre batch alternativa |
| Retry | Resposta perdida; mesmo body/clientIds/revision não duplica; GET recupera criação por creationRef; reload com journal preservado; perda de clientId não gera reenvio automático; ref persistida com nova base é recusada; colisão UUID reverte tudo |
| Público/F3B | Nove itens atuais equivalentes, todos visíveis posteriores presentes, ocultos filtrados, nenhuma cachaça escolhida arbitrariamente; transição legado/v2; várias garrafas/variantes; máscara preservada; criar/reordenar/salvar/recarregar; foco, mobile e conflito |

Manter os testes existentes e ampliar expectativas quando necessário, sem reduzir
cobertura. D1 real local descartável para handlers/migrações, não apenas mocks.
Gates finais: typecheck frontend/backend, Biome, Vitest completo, backend D1,
Playwright Chrome instalado, build, npm audit e diff --check. Rodar suites pesadas
separadamente para evitar os timeouts de contenda já observados.

## 8. Veredito, aprovações e riscos

Direção aprovada pelo usuário: modelo unificado, categorias estruturais, novos chopes/
múltiplas cachaças, IDs/dados preservados, centavos, metadata/revisão, refs persistentes,
APIs v2, atomicidade/autorização e ausência de exclusão persistente/editor genérico.

Recomendação final: **A, 0005 única com corte coordenado, sem espelho; comando único**.
**GO técnico para iniciar implementação após autorização explícita**, ainda pendente.
Esse GO não aprova deploy, migration remota, recursos Cloudflare ou integração F3B.

- Risco de implementação alto: janela realmente sem escritores, gate de schema pronto
  e aposentadoria HTTP/SQL de todos os writers v1. Testar antes de liberar PUT v2.
- Risco residual: backup e retorno depois de novos cadastros não são lossless no modelo
  antigo; restauração pode reutilizar tokens de revisão. Invalidar sessões/rascunhos.
- Recuperação por creationRef depende do clientId retido. Journal perdido não permite
  reconciliação automática confiável; leitura/revisão manual e bloqueio de retry cego.
- Os tetos de corpo/itens/variantes continuam propostas de orçamento, não capacidades
  aprovadas pelos PoCs. A migration/handlers finais precisarão de seus próprios gates.
- Quotas, CPU de autenticação, ataques distribuídos, ausência de auditoria persistente
  e comportamento remoto permanecem pendências. Não há recursos remotos autorizados.
- Futuras categorias/embalagens podem exigir apresentação e regras novas, com aprovação;
  não converter isso em editor universal ou omitir dados para manter o visual antigo.

## 9. Evidências dos PoCs autorizados

Executados em 14/10/2026, com Node v26.7.0, Wrangler 4.151.0 e Miniflare
4.20260730.0. Configs sintéticas POC_DB, --local e persistências exclusivas em
diretório temporário; cópias somente leitura das migrations 0001–0004 do repositório.
Nenhum segredo real, banco do projeto, D1 remoto ou worktree do Claude foi utilizado.
Resultado agregado: **33/33 casos passaram**, incluindo o contraexemplo inseguro
que deveria permitir a mutação e demonstrou precisamente esse comportamento.

Relatórios e scripts temporários (não são arquivos de produção):

- [Consolidado dos 33 casos](C:/Users/zZzZz/AppData/Local/Temp/delegas-f3a2-poc-Wj7HXr/summary.json)
- [30 casos principais e hashes](C:/Users/zZzZz/AppData/Local/Temp/delegas-f3a2-poc-Wj7HXr/report.json)
- [3 casos adicionais](C:/Users/zZzZz/AppData/Local/Temp/delegas-f3a2-poc-Wj7HXr/extra-evidence/report.json)
- [Runner principal](C:/Users/zZzZz/AppData/Local/Temp/delegas-f3a2-poc-Wj7HXr/runner.mjs) e
  [runner adicional](C:/Users/zZzZz/AppData/Local/Temp/delegas-f3a2-poc-Wj7HXr/extra.mjs).

Os runners são experimentos de execução única por diretório: para repetir, copiar os
scripts para um novo diretório temporário vazio e executar com Node; não reutilizar
os bancos experimentais já migrados. Não aplicar a SQL experimental ao banco do projeto.

| Evidência | Resultado |
|---|---|
| Cópia de catálogo previamente editado | 9 itens, 17 variantes, 3 preços null; nomes/descrições/IDs/29 e 49099 centavos/visibilidade/ordens empatadas/volume alterado preservados; FK limpa |
| catalog_meta | Mesma tabela e linha; revisão 73 → 74 no corte; reaplicação preservou 74 |
| Falha após DDL, backfill, retirada antiga e revisão | Schema, dados e histórico iguais ao estado anterior; sem 0005 registrada; retry corrigido passou |
| Falha no INSERT do próprio d1_migrations | Todo o arquivo, DDL e revisão revertidos; retirado o trigger de falha experimental, reaplicação passou |
| EXCEPT bidirecional | Variante ausente e item extra foram rejeitados, com rollback total |
| Origem com preço zero ou ID em conflito entre tabelas | Migration recusada, sem alterar/reparar a origem ou registrar sucesso |
| Schema parcial pré-existente | Reaplicação recusada; não foi marcado pronto nem reparado; restauração da cópia consistente e aplicação limpa passaram |
| Escritores legados | Seis I/U/D em products/cachaca bloqueados e catalog_save indisponível, sem alteração comercial |
| Comando único | Criação + edição juntas; duas sessões/mesma base admitiram uma só; revogação/expiração/version/usuário/origem/revisão antiga não escreveram |
| Escrita ignorada/erro posterior | Falha de preço, INSERT de variante ignorado e SELECT final com erro reverteram itens, variantes, refs e revisão |
| Revision opaca e retry | Save experimental 74 → 78; no-op preservou revisão; retry antigo não criou duplicata; consulta por ref encontrou ID definitivo |
| Guarda sem erro (contraexemplo) | Zero linhas na guarda **não** impediu a mutação seguinte: insegurança esperada reproduzida |
| Guarda com erro + provas + verificação final | Sucesso e recusa por sessão/revisão/metadata/IGNORE; expiração entre statements detectada no fim com rollback |
| Identidade de variantes persistentes | Omissão de variante null e de item oculto recusada em SQL, revertendo uma mutação anterior na batch |

São provas de mecanismos em D1 local, sem handler HTTP v2 e sem orçamento de carga.
Os 339/307/39 testes anteriores não foram repetidos nesta rodada exclusivamente
arquitetural. Na implementação, todos os gates e testes novos continuam obrigatórios.

## Fontes primárias consultadas

- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch):
  sequência transacional e rollback em erro. A estratégia acima é uma proposta
  derivada dessa semântica e dos PoCs; não substitui testes da implementação final.
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/):
  versionamento e controle d1_migrations.
- [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/):
  enforcement e defer_foreign_keys por transação.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/):
  50/1000 queries por invocação (Free/Paid), 100 parâmetros por statement na consulta atual.
- [SQLite triggers](https://www.sqlite.org/lang_createtrigger.html): RAISE(ABORT)
  e restrições de statements em triggers.
- [SQLite relógio](https://www.sqlite.org/lang_datefunc.html): estabilidade de now
  por sqlite3_step, sem promessa de congelamento entre statements da batch.

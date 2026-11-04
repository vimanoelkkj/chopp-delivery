# CMS M3A — capacidade reutilizável, sem descarte de históricos

Baseline: integration/immersive-cms-f4a, HEAD 98ac04f52b7366f35a6517cb9878dec7696cdfd7.

## Regra e limites

Antes: 100 linhas de cms_media por toda a vida da biblioteca, incluindo tombstones.
Depois da migration 0010: no máximo 100 posições ocupadas por mídia com state diferente de deleted.

| Estado | Ocupa posição? | Motivo |
| --- | --- | --- |
| quarantined / processing | Sim | Reserva em andamento, inclusive worker interrompido. Expirar o prazo não libera espaço sozinho. |
| ready | Sim | Derivados utilizáveis/retidos, mesmo se não estiverem no rascunho atual. |
| rejected | Sim, até exclusão concluída | Uma falha pode deixar objetos privados órfãos. Não se presume limpeza só pelo estado rejected. |
| deleting | Sim | Limpeza incompleta ainda pode ocupar armazenamento. |
| deleted | Não | Exclusão ou reconciliação concluídas; tombstone, jobs e recibos continuam no D1. |

A capacidade é uma cota de posições/reservas, não medição de bytes ou garantia de custo R2. Rejeições deixam de consumir capacidade após DELETE administrativo existente, ou recuperação de exclusão pela reconciliação, chegar a deleted. Não foi implementado um botão de exclusão na UI: o endpoint administrativo já existente é o caminho explícito. Não há limpeza automática, GC de revisões, retenção de originais ou substituição de bytes em um mesmo ID.

## Integridade preservada

As guardas de referência v1 e v2 permanecem byte a byte. Mídia associada ao rascunho atual não pode ser excluída; remover a associação do rascunho NÃO basta se qualquer revisão histórica ainda a referenciar. Versões, referências, recibos e evidências continuam imutáveis. Não se apagam linhas para liberar capacidade.

Uma biblioteca com 100 mídias protegidas por históricos pode continuar esgotada. Isso é um limite deliberado: liberá-las exigiria política autorizada de descarte/arquivamento de revisões, fora de M3A. Esta entrega recupera vagas de mídia não referenciada cuja exclusão foi concluída; não promete liberar toda biblioteca já esgotada.

## Evolução e compatibilidade

0010_cms_media_capacity.sql instala um novo trigger de início de job com a mesma lógica histórica, mudando apenas a contagem para state <> deleted. Depois remove o trigger antigo. A view cms_media_capacity é criada por último e informa limite, consumo e includes_tombstones=0.

A troca do trigger é tecnicamente necessária: manter o trigger antigo continuaria rejeitando uploads pelo total histórico. A instalação coloca a guarda nova ANTES de remover a anterior. Um prefixo interrompido pode bloquear escritas pela coexistência dos triggers, mas não admite uma reserva sem guarda. Não há ALTER em dados/tabelas ou edição das migrations 0001–0009. Não se afirma que esse ensaio de prefixo substitua homologação remota completa de migrations.

O backend detecta a view de capacidade. Banco sem a view mantém contagem legada e includesTombstones=true. Banco atualizado usa a projeção SQL nova e includesTombstones=false; limit/consumed/remaining continuam no mesmo envelope. O frontend passa a aceitar ambos os valores booleanos e mostra a política realmente retornada pelo banco. Não houve alteração dos documentos/contratos CMS v1/v2.

Compatibilidade de implantação futura: atualizar consumidor e backend compatíveis antes/junto da migration. Consumidor antigo rejeita a política false de forma fechada; backend antigo continua contando todo o histórico de maneira conservadora, mesmo no schema novo. Rollback de aplicação não exige apagar dados ou desfazer o schema automaticamente. Esta rodada não implantou nada.

## Evidências proporcionais

Quatro arquivos de teste, 38 casos distintos aprovados ao final das execuções direcionadas:
- media-capacity.test.ts: 4 unidades SQLite em memória. Upgrade de 100 tombstones sem perda de linhas, contagem dos estados, recusa atômica da 101ª reserva e prefixo de instalação sem admissão insegura.
- mediaApi.test.ts: 15 unidades do cliente, inclusive política nova false, validação estrita e compatibilidade true.
- mediaModel.test.ts: 18 unidades, incluindo texto da capacidade reutilizável e limites existentes.
- media-capacity-integration.test.ts: UM cenário D1/R2/Images descartável, com handlers reais, concorrência pela última posição, rejeição e exclusão, recusa de quota, reutilização, referência v1, conversão v2, proteção atual/histórica, falha de limpeza, reconciliação e replay de recibos após exclusão.

O cenário integrado demonstrou: rejeição ocupa uma vaga; DELETE concluído libera; limite de 100 continua efetivo; duas tentativas concorrentes têm exatamente um sucesso e um 409; exclusão parcial R2 conserva a reserva; reconciliação libera só após limpeza; históricos e recibos permanecem idênticos; replay não cria nova reserva; publicação continua nula.

As primeiras execuções encontraram expectativas de mensagens antigas, uma soma incorreta de linhas na fixture e falta de registro de migrations no ledger da fixture (a prontidão v2 recusou corretamente a conversão). Foram corrigidos texto/fixture, sem reduzir guardas, aumentar timeouts ou enfraquecer asserções. Não houve defeito de persistência atribuído a essas falhas de preparação.

Typecheck: exit 0. Biome dos arquivos afetados: exit 0, com uma informação preexistente de concatenação em mediaApi.test.ts. Uma falha intermediária de formatação CRLF foi corrigida somente no arquivo editado, sem mudança lógica. A expectativa includesTombstones do E2E real existente foi atualizada para false, pois seu harness aplica todas as migrations; esse E2E NÃO foi executado, conforme o limite desta rodada.

Comandos/evidências: %TEMP%/chopp-cms-m3a/targeted.log, targeted-final.log, integration-final.log e delivery-manifest.json. Apenas os arquivos direcionados foram executados; nenhuma suíte completa Vitest/Playwright/E2E, build normal/release ou recurso remoto. Migrations foram aplicadas somente em SQLite :memory: e D1 d1Persist=false; R2 r2Persist=false, fechados ao fim.

## Escopo e checkpoint

Nova migration 0010, projeção de capacidade em media-queries, compatibilidade e textos do cliente, testes diretamente afetados e este relatório. Não foram alterados homepage, catálogo, autenticação, publicação, SQL histórico ou arquivos externos protegidos. Graphify consultado para impacto e confrontado com o código; saída truncada, sem regeneração ou mudança de configuração. O cache operacional de consulta pode mudar e fica fora da entrega.

GO técnico para consolidação local de M3A, sujeito à avaliação. Sem commit, staging Git, push, deploy ou acesso a bancos mantidos. Não iniciar retenção avançada, descarte de revisões ou etapa posterior.

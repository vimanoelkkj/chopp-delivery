# Preflight somente leitura da migration 0005

A F3A.2 foi consolidada em `e306ea82562ea8ac0d4bbff71073eb324d820ebe`, após
auditoria independente GO WITH NOTES. Esta ferramenta é uma alteração posterior,
com commit local autorizado após revisão direcionada. A migration 0005 não foi
editada; não há dual-write.

## Execução local

Requer Node.js com `node:sqlite`, remoção nativa de tipos TS e `registerHooks`;
validado com Node **26.7.0**, sem dependências novas. No repositório:

O modo de abertura segue a [API SQLite do Node](https://nodejs.org/api/sqlite.html#new-databasepath-options).
O procedimento de aplicação permanece o de [migrations D1](https://developers.cloudflare.com/d1/reference/migrations/).

```powershell
npm.cmd run catalog:preflight -- --sqlite 'C:\Backups\delegas\snapshot.sqlite'
$LASTEXITCODE
```

O caminho é obrigatório, refere-se a um arquivo local existente e não é descoberto
automaticamente a partir do binding. Nenhuma flag remota é aceita. A CLI não importa
Wrangler/Miniflare, não lê credenciais, não cria banco ausente e não executa migrations.
Abre SQLite com `readOnly: true` e URI construída internamente com
`mode=ro&immutable=1`, desabilita extensões, ativa `query_only` na conexão e mantém
uma transação de leitura. BEGIN/ROLLBACK e query_only controlam somente a conexão;
não são alterações no catálogo. Não há abertura alternativa com permissão de escrita,
nem durante recuperação de erros. O relatório só é emitido depois de fechar o SQLite.

Não use uma cópia isolada do arquivo principal feita enquanto há gravações: dados
recentes podem estar no WAL. A CLI aceita somente um **arquivo autônomo em modo
rollback (DELETE)**: verifica o cabeçalho e recusa modo WAL e qualquer auxiliar
`-wal`, `-shm` ou `-journal` antes de abrir o SQLite, mesmo que o auxiliar esteja vazio.
Não apague esses arquivos para contornar o bloqueio. O modo immutable impede
escritas e criação de auxiliares, mas desativa locks/detecção de mudanças do SQLite;
por isso não serve para consultar um banco ativo. A CLI também recusa mudanças de
tamanho, identidade ou timestamps observadas durante a leitura. Isso não comprova
a procedência de uma cópia nem substitui o backup consistente.

Prepare o snapshot separadamente:

1. Pare todos os escritores do estado Delegas e preserve um backup bruto completo,
   incluindo WAL/journal existentes. Não copie apenas o arquivo principal de um
   runtime ativo. Nunca use bancos de outros projetos/worktrees.
2. Use a [API de backup SQLite](https://sqlite.org/backup.html) ou procedimento
   equivalente que inclua as transações confirmadas do WAL. Se for necessário abrir,
   recuperar ou converter arquivos, faça isso numa **cópia de trabalho descartável**,
   preservando o backup bruto; nunca no snapshot final informado à CLI.
3. Gere outro arquivo final consistente em modo DELETE, feche todas as conexões e
   confirme que ele é autônomo. Não basta renomear o banco ou remover seus auxiliares.
   Um export SQL D1 precisa ser restaurado separadamente numa base descartável para
   produzir esse SQLite; o preflight não importa SQL nem executa restaurações.
4. Guarde o arquivo final sem escritores e execute a CLI somente sobre ele. Caso
   haja bloqueio, preserve o arquivo para diagnóstico e prepare outro snapshot.

Consulte as [regras oficiais de WAL e leitura somente leitura](https://sqlite.org/wal.html#read_only_databases).
O preflight não cria backup, executa checkpoint, converte journal mode ou repara WAL.

## Diagnóstico e validação

A saída JSON contém `ok`, `migration`, `counts` e `blockers`. Cada bloqueador tem
`code`, `table`, `message` e, quando aplicável, `recordId`, `row` e `field`.
Nomes inválidos incluem até 16 codepoints (`U+200B`, por exemplo). A saída escapa
caracteres não ASCII para não esconder IDs invisíveis nem executar controles do
terminal; JSON.parse recupera os valores exatos. Não há trim, normalização Unicode,
conversão monetária, geração de IDs, alteração de visibilidade ou descarte de linhas.

| Código de saída | Resultado |
|---|---|
| 0 | Snapshot de origem 0004 aprovado para as verificações conhecidas |
| 1 | Bloqueadores encontrados, inclusive leitura/schema/integridade incompletos |
| 2 | CLI indisponível, argumentos inválidos, arquivo ilegível ou snapshot não autônomo/instável |

Verificações:

- Histórico 0001–0004 presente exatamente uma vez; 0005 ou histórico inesperado
  indica que esta ferramenta não se aplica à origem. Não tente remigrar um banco
  já expandido nem apague seu histórico.
- Tabelas/colunas de origem, objetos retirados pela 0005 e ausência de objetos de
  destino/helpers preexistentes. Colunas extras e triggers não previstos sobre
  as tabelas/comando do catálogo exigem revisão manual, para impedir descarte ou
  efeitos ocultos. Nomes CREATE/DROP são obtidos do arquivo 0005 sem executá-lo.
- `integrity_check` completo, `foreign_key_check` global (inclusive referências fora do catálogo)
  e compilação das dependências de autorização pós-corte, sem consultar credenciais.
  O núcleo compartilhado usa `quick_check`, compatível com D1; o adaptador SQLite
  da CLI obrigatoriamente o substitui por `integrity_check`, incluindo índices/UNIQUE.
- Singleton/revisão segura com espaço para o avanço do corte; colisões globais de IDs.
- **Os próprios validadores v2** de IDs, texto, centavos e volume: nomes precisam
  ter caractere visível, Unicode válido, até 120 caracteres e nenhum controle/bidi
  proibido. Descrições seguem exatamente a regra v2, inclusive multiline e limite
  2000. ZWJ/acentos em nomes visíveis não são removidos nem rejeitados arbitrariamente.
- Bytes UTF-8 de id/nome/descrição são comparados com sua representação recebida,
  para impedir que um decoder substitua silenciosamente texto SQLite inválido.
- Preços positivos inteiros até 9999999; null apenas nos tamanhos de chope.
  Cachaça exige preço/volume positivo seguro. Visibilidade 0/1, ordem 0–2147483647
  e item visível com ao menos um preço. Ocultos também são validados.
- Snapshot completo projetado (30/50 e bottle, sem excluir variantes null), usando
  `validateExpanded`, e orçamento do PUT v2: 128 itens, 512 variantes e 128 KiB UTF-8.
  Limites comerciais/estruturais não são ultrapassados por truncamento. A projeção
  completa é avaliada quando os dados/pré-condições básicos permitem representá-la;
  falhas anteriores nunca produzem GO.

Exemplo de bloqueador:

```json
{"code":"INVALID_TEXT","table":"products","recordId":"dronken","row":1,
 "field":"name","message":"Nome exige caractere visível...","codePoints":["U+200B"]}
```

Uma falha de schema/leitura pode impedir verificar outras linhas; o resultado
permanece bloqueado e deve ser repetido após diagnóstico manual. Não existe opção
`--fix`, nem migração experimental/rollback sendo executado pelo preflight.

## Antes de um deploy futuro

1. Obter autorização específica para o ambiente e procedimentos remotos. Esta
   entrega **não** acessa D1 remoto, exporta produção ou publica código.
2. Conferir projeto/binding e origem 0004; parar escritores e preparar backup
   consistente/verificado, com plano de recuperação da janela sem escritores.
3. Executar a CLI sobre a cópia local; guardar o JSON como evidência fora do Git.
4. Com bloqueadores, interromper o corte. Diagnosticar e aprovar cada correção
   separadamente; a ferramenta não propõe apagar, normalizar ou substituir dados.
5. Garantir que o banco alvo continue igual ao snapshot validado até o corte;
   se houver gravações após a cópia, repetir backup/preflight. Um resultado 0
   não garante contra mudanças posteriores, falhas de infraestrutura, quotas,
   schema arbitrariamente adulterado ou regras novas fora do contrato conhecido.
6. Só então seguir o [runbook de corte e recuperação](catalog-expansion.md).
   Não tratar schema parcial como pronto nem substituir as asserções SQL da 0005.

## Testes

```powershell
npm.cmd test -- tests/backend/catalog-preflight.test.ts tests/backend/catalog-preflight-cli.test.ts --maxWorkers=1
```

Os testes usam D1 Miniflare descartável com a origem 0004 e SQLite temporário real
para a CLI. Comparam linhas/schema/revisão/histórico e hash/listagem de arquivos
antes e depois. Cobrem nomes só com caracteres invisíveis, Unicode visível válido,
UTF-8 malformado, preços/volumes incompatíveis e inteiros grandes sem arredondamento,
FK inválida, orçamento, colisões, histórico, schema parcial e rejeição de entrada remota.
Também cobrem WAL ativo, arquivo em modo WAL sem auxiliares, cópia com WAL ausente,
journal pendente, arquivo corrompido e índice UNIQUE inconsistente que `quick_check`
não detecta. Os testes nunca recebem o caminho do operador: criam os próprios arquivos
com `mkdtemp` e só esses fixtures são preparados com conexões graváveis. A CLI usa
sempre abertura somente leitura, inclusive quando o resultado é uma falha.

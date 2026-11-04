# CMS M3F — configuração de homologação e consulta privada

## Baseline e resultado

Branch `integration/immersive-cms-f4a`, HEAD `176651b780919c6039b6e48bcbff553374be69de`.
**GO para consolidação local.** Os dois mecanismos locais foram preparados: geração condicionada de configuração Wrangler separada e consulta de metadados pelo Worker existente. **Não há homologação remota ativada ou validada.**

## 1. Configuração executável sob parâmetros reais do operador

`scripts/prepare-pages-homologation.mjs` constrói uma configuração Pages independente. Não lê, copia nem herda `wrangler.jsonc`, `.env`, `.dev.vars`, credenciais do processo ou o plano de produção. Não importa Wrangler nem acessa rede.

O operador deve fornecer um JSON com exatamente os campos:

| Campo | Regra |
| --- | --- |
| `environment` | Literal `homologation` |
| `projectName` | Nome real do projeto Pages exclusivo, minúsculas, números e hífens |
| `origin` | Origem HTTPS canônica real, sem caminho/query/credenciais/porta não canônica; não aceitar loopback, IP ou domínios reservados de exemplo/teste |
| `databaseName`, `databaseId` | Nome real e UUID não trivial do D1 exclusivo |
| `production.projectNames` | Inventário explícito dos projetos de produção |
| `production.databaseIds` | Inventário explícito dos IDs D1 de produção |
| `production.origins` | Inventário explícito das origens de produção |
| `acknowledgeDedicatedResources` | Literal true, após revisão independente dos recursos |

Listas de produção vazias só devem ser usadas quando o operador confirmou que não existem recursos desse tipo. Campos ausentes, extras, secrets ou overrides arbitrários são recusados. Projeto, origem e D1 da homologação não podem coincidir com o inventário de produção. Para uma origem Pages padrão, o hostname deve corresponder ao projeto informado.

**Limite de verificação:** formato UUID e declaração do operador não comprovam existência, propriedade ou exclusividade real do recurso. Sem acesso à conta, essa conferência continua operacional. O gerador não transforma identificadores sintaticamente válidos em recursos certificados.

### Saída e execução local futura

Somente depois de receber e revisar o arquivo real de parâmetros:

```powershell
node scripts/prepare-pages-homologation.mjs --parameters C:/caminho-do-operador/inventario-real.json
```

O caminho acima indica o arquivo que o operador deverá fornecer; não foi criado nem executado com dados fictícios. A saída fixa é `wrangler.homologation.jsonc` na raiz do repositório, escrita com `flag:wx`: nunca sobrescreve um arquivo existente. Erros não imprimem o conteúdo do inventário.

O arquivo resultante é um Wrangler Pages convencional, não o documento de planejamento M3B:

- `name` e D1 vêm exclusivamente do inventário fornecido;
- `pages_build_output_dir: ./dist-release` e `migrations_dir: migrations` são relativos à raiz;
- `compatibility_date: 2026-08-06`, mesma referência atual do projeto;
- apenas `DELEGAS_DB` e `ADMIN_ORIGIN` configurados no contexto principal da homologação;
- `r2_buckets:[]`, `services:[]` e nenhum secret, flag local ou variável fictícia de publicação;
- `env.preview` explicitamente sem D1, origem administrativa, R2 ou serviços. Previews não recebem o banco do contexto principal por esta configuração.

No Pages, o contexto principal é chamado `production` pela plataforma, mesmo num projeto exclusivo de homologação do negócio. Não foi inventado `env.homologation`. O projeto de produção real permanece separado. Secrets de preview e configurações da conta também precisam de revisão própria; o arquivo não remove secrets anteriormente existentes no provedor.

**Nenhum `wrangler.homologation.jsonc` foi gerado nesta entrega**, pois não há parâmetros reais do operador. Os testes constroem objetos em memória com UUIDs sintéticos, sem persistir configuração executável fictícia. A ausência de parâmetros impede a materialização, não provoca fallback para `dist` ou para o binding local.

Quando futuramente autorizado, o operador deverá selecionar explicitamente esse arquivo nas operações Pages, conferir o artefato release e os bindings e tratar a configuração como fonte de verdade. O gerador apenas escreve JSON local: não executa build, deploy ou migrations. O `wrangler.jsonc` local continua intacto.

A configuração de Access não é ativada pelo gerador. Antes de enviar conteúdo, proteger todo o hostname canônico, o domínio Pages principal, aliases e URLs de preview, incluindo assets, `/admin/*`, `/api/auth/*`, `/api/admin/*` e frames, conforme o inventário M3D/M3E.

## 2. Consulta privada de metadados

O Worker `server/auth/maintenance-worker.ts` agora aceita, além das operações existentes, o comando estrito:

- `commandId`: UUID v4 não secreto;
- `environment`: `homologation`;
- `action`: `inspect`.

Não aceita campos de escrita nesse comando. Usa a mesma entrada `scheduled`, o opt-in `armed-v1`, `MAINTENANCE_ENVIRONMENT`, D1 e origem HTTPS canônica. Flags de localhost continuam proibidas. `inspect` não exige `MAINTENANCE_PASSWORD` nem `ADMIN_PASSWORD_PEPPER`: uma consulta de metadados não precisa desses segredos. Escritas continuam exigindo os secrets e a configuração F2 completa após o despacho da operação.

A única consulta é:

```sql
SELECT id, username, active, auth_version FROM admin_users LIMIT 2
```

Não acessa hashes, senha, pepper, sessões, catálogo, mídia ou histórico editorial. Só aceita resposta D1 bem formada e zero ou um proprietário. Dados inválidos, múltiplos proprietários, falha de SQL ou resposta malformada produzem `UNCONFIRMED`, nunca um falso resultado de conta ausente.

A saída no canal de logs operacional contém apenas `commandId`, `result:INSPECTED` e `owner`:

- `owner:null`: não havia proprietário na leitura;
- caso contrário: `id`, `username`, `active` booleano e `authVersion`.

A saída é construída campo por campo; não há spread da linha do banco ou do ambiente. Os logs são dados administrativos privados e precisam de permissão operacional apropriada. Exceções não são serializadas. Não há retorno HTTP, endpoint de consulta, cookie adicional nem segundo sistema de autenticação.

## Procedimento operacional futuro

1. Aprovar o projeto/origem exclusivos, inventário real, política Access e acesso nominal ao plano de controle. Gerar/revisar o arquivo Wrangler local somente com esse inventário. Provisionamento, secrets, deploy e migrations continuam exigindo autorização própria.
2. No Worker de manutenção, conferir o D1 efetivamente vinculado. A etiqueta `homologation` não identifica o banco; revisão de bindings permanece obrigatória. Configuração versionada segue sem D1, sem secrets e com agenda/rotas/URLs desabilitadas.
3. Definir o comando `inspect` no canal de configuração autorizado, armar e agendar somente em etapa explicitamente autorizada. Consultar sua saída pelos logs privados da plataforma; não há necessidade de SQL manual. Confirmar `commandId`, ambiente e frescor da observação. Desarmar ao terminar.
4. Para bootstrap, `owner:null` permite preparar a operação com versão esperada 0. O núcleo ainda reavalia a ausência no INSERT: uma leitura anterior não autoriza substituir uma conta criada concorrentemente.
5. Para recuperação, usar ID, username e `authVersion` da inspeção, fornecendo a nova senha por secret de runtime e mantendo a versão original. Não recuperar conta desabilitada nem ajustar versão automaticamente após conflito.
6. Após a operação, fazer nova inspeção com outro `commandId`. Confirmar identidade, estado e versão; verificar o acesso pelo login F2 normal. Não logar a senha para essa confirmação.
7. Resultado desconhecido ou observação concorrente não autoriza novo comando de escrita automático. Desarmar, retirar cron e senha temporária ao encerrar, mantendo o pepper necessário ao login da aplicação. A remoção de cron pode propagar com atraso; `noRetry` não cancela recorrências.

**O que a inspeção confirma:** estado atual observado do proprietário e a versão utilizável para um novo comando condicional. Ela não é recibo imutável do bootstrap/recovery anterior e não prova, sozinha, que uma senha específica foi aplicada. Outro comando concorrente pode ter avançado a versão. Correlação operacional e login F2 continuam necessários diante de resposta/log perdido. Não foram criados recibos paralelos ou logs com material criptográfico.

A gestão de secrets deve separar preparação de ativação: comandos como `wrangler secret put` podem publicar uma versão imediatamente. Não executar isso como se fosse apenas provisionamento. Esse procedimento permanece um requisito operacional herdado de M3E, não foi executado agora.

## Validação proporcional

| Verificação | Resultado |
| --- | --- |
| Novo teste de inspeção antes da implementação | Vermelho: nenhuma consulta/saída INSPECTED existia |
| `npm test -- tests/backend/auth-maintenance-worker.test.ts --maxWorkers=1` | 27/27 aprovados, exit 0 |
| `node --test scripts/prepare-pages-homologation.test.mjs` | 15/15 aprovados, exit 0 |
| Typecheck backend `tsc -p tsconfig.backend.json --noEmit` | Exit 0 |
| Biome dos quatro arquivos JS/TS afetados | Exit 0 |
| `git diff --check` e whitespace dos cinco arquivos da entrega | Exit 0 |

Casos novos: saída sem segredos e sem exigir senha/pepper; conta ausente; revisão inválida; múltiplos proprietários; envelope/linha nulos; falha SQL sanitizada. Os testes preexistentes mantêm concorrência/versão e ausência de entrada HTTP/agenda. O primeiro teste parametrizado novo tinha o formato de tabela incorreto, corrigido sem alterar as asserções; a implementação também passou a recusar envelopes/linhas malformados explicitamente.

No gerador: output release/D1 exclusivo e preview sem bindings, rejeição de IDs placeholders/zerados, reutilização de produção, origem insegura/reservada/de outro projeto, inventário incompleto e injeção de secrets/overrides. CLI sem parâmetros falha sem criar arquivo. Chaves de saída conferidas contra o schema Wrangler instalado; não houve validação de deploy ou normalização completa pelo CLI.

Sem suítes completas, Playwright, E2E reais, builds gerais, migrations ou recursos remotos. Testes do Worker usam doubles D1 e mocks dos helpers F2 já aprovados; não são uma nova demonstração da atomicidade SQL nem de persistência dos logs Cloudflare. Nenhuma dependência instalada.

## Graphify e preservação

Skill Graphify consultada via grafo existente em modo somente leitura: 2.085 nós, sete sementes e 83 relações incidentes. Dependências relevantes de bootstrap/auth/gate de mídia confirmadas diretamente no código. O Worker novo não está indexado no grafo histórico; seus imports permanecem os mesmos e o SQL foi conferido contra as colunas existentes. O gerador só depende de módulos Node e não importa backend, frontend ou configuração local. Sem ciclos novos, regeneração ou alteração de cache/configuração.

Arquivos externos protegidos, correção CP0, migrations 0001–0010, homepage, publicação, backend CMS e plano M3B permanecem intactos. Índice vazio, sem commit. Snapshot e manifesto SHA-256 exclusivo em `%TEMP%/chopp-cms-m3f/`.

## Bloqueadores restantes

- Inventário real do operador e conferência independente da exclusividade dos recursos: ainda não fornecidos. A configuração executável não pode ser materializada honestamente sem eles.
- Access e hostnames efetivamente protegidos, identidades/permissões e bindings corretos: não provisionados nem verificados.
- Secrets, logs privados, frescor/correlação de observações e execução agendada reais: dependem de futura homologação controlada.
- Mídia remota, publicação e consumo público CMS continuam deliberadamente desabilitados. Não são habilitados pelo gerador ou pela inspeção.

**GO para consolidação local M3F. NO-GO para implantação/execução remota automática.** Os bloqueadores de mecanismo local foram endereçados sem substituir as decisões e evidências operacionais que ainda cabem ao operador.

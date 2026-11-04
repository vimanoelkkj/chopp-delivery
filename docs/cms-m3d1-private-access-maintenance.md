# CMS M3D.1 — acesso privado e manutenção (preparação local)

## Baseline e escopo

Branch `integration/immersive-cms-f4a`; HEAD `fe1b3604aeae4eb3ca09244887ee6f4e40980fa9`.
Implementação somente local. Sem commit, recursos Cloudflare, secrets reais, aplicação de migrations, E2E real, build geral, publicação ou alteração da homepage.

## Respostas HTTP e sessão Access

- `httpResponse.ts` recusa respostas redirecionadas, redirects explícitos/opaques e Content-Type diferente de `application/json`.
- Clientes afetados usam `redirect: error`: o navegador não segue automaticamente uma escrita até uma página de login. Nenhum token Access é lido pelo JavaScript nem usado como autorização F2.
- Logout só confirma HTTP 200 com JSON exatamente `{ok:true}`. HTML, JSON inesperado, redirect, falha de rede ou outro status retornam false; `useAdminSession` conserva o estado quando a revogação não foi confirmada.
- Sessão F2 e comandos CMS/mídia só reconhecem 401/403 como erro F2 após o envelope correspondente (`UNAUTHENTICATED` / `INVALID_ORIGIN`). HTML ou JSON externo não aciona indevidamente a expiração F2. JSON malformado, inclusive em 404, não confirma ausência de recibo.
- No salvamento, a resposta externa/inválida vira resultado desconhecido. O fluxo existente mantém documento, revisão e operationId; faz apenas consulta GET de recibo e não repete PUT/POST automaticamente. Campos e novos salvamentos ficam bloqueados enquanto o resultado é inconclusivo.
- A aplicação não consegue provar que qualquer HTML veio do Access; a classificação é conservadora. Para recuperar acesso, manter a aba do editor aberta, autenticar no hostname canônico em outra aba e voltar a `Verificar agora`. Não recarregar a aba com alterações pendentes. Não foi criado armazenamento local, autosave ou fluxo de autenticação alternativo.
- A leitura inicial CMS e o gateway do catálogo também recusam redirects/HTML. F2, seus cookies, CSRF e endpoints permanecem inalterados no servidor.

## Worker separado, sem entrada HTTP

`server/auth/maintenance-worker.ts` exporta somente `scheduled`. A configuração dedicada é `config/cloudflare/maintenance-worker.jsonc`:

- `workers_dev:false`, `preview_urls:false`, `routes:[]`;
- `triggers.crons:[]` e `MAINTENANCE_ENABLED:disabled`;
- nenhum binding D1/R2/Images/service e nenhum secret preenchido;
- não importado por Pages Functions, frontend ou scripts de deploy;
- não altera `wrangler.jsonc` nem o plano M3B.

A configuração está deliberadamente incompleta para uso remoto. Não é autorização de deploy nem prova de que a plataforma aceitará um Worker sem rota e sem agenda ativa. A validação operacional disso permanece futura.

Cada execução chama `noRetry()` e permanece inerte sem opt-in `armed-v1`. Recorrências de um cron são diferentes de retries: uma agenda futura deve ser removida pelo operador após a operação; não foi habilitada agora.

### Precondições e comando

Para um operador futuro, antes de qualquer agendamento:

| Configuração | Regra |
| --- | --- |
| `MAINTENANCE_ENVIRONMENT` | Exatamente `homologation` |
| `ADMIN_ORIGIN` | Origem HTTPS canônica sem caminho, credenciais ou loopback |
| `ADMIN_PASSWORD_PEPPER` | Mesmo secret F2 do ambiente, 64 hex; nunca fornecido pelo browser |
| `MAINTENANCE_PASSWORD` | Secret temporário definido pelo responsável, sem valor padrão |
| `DELEGAS_DB` | Binding exclusivo do ambiente, ausente nesta configuração |
| `ADMIN_ALLOW_INSECURE_LOCAL`, `CMS_MEDIA_LOCAL` | Devem estar ausentes |
| `MAINTENANCE_COMMAND` | JSON estrito até 2.048 caracteres, definido pelo operador autorizado |

Campos de comando: `commandId` UUID v4 não secreto, `environment:homologation`, `action`, `username`, `expectedAuthVersion` e, apenas para recuperação, `ownerId`. Chaves desconhecidas são recusadas. Senha e pepper não pertencem ao comando.

- Bootstrap exige versão esperada 0, representando ausência de proprietário. Reutiliza `bootstrapOwner`, cujo INSERT condicional/singleton não substitui conta existente.
- Recuperação exige versão positiva e chama `recoverOwnerCredentials` com a versão original. Reutiliza a proteção CAS e a revogação atômica de sessões F2 existentes. Não incrementa a versão no cliente nem transforma conflito em outra tentativa.
- Somente `commandId` validado e `APPLIED`, `NOT_APPLIED` ou `UNCONFIRMED` são registrados. Erros, SQL, ambiente, senha e pepper não são serializados nos logs.
- Logs não são recibos imutáveis. Um crash após persistência pode deixar resultado desconhecido. `NOT_APPLIED` não recupera o resultado de uma tentativa anterior. Não foi criado um segundo sistema de recibos.

A etiqueta de ambiente não comprova a identidade real do D1. O binding e os secrets precisam de revisão independente antes de qualquer ativação; o runtime não identifica um banco de produção vinculado incorretamente. Isso permanece bloqueador operacional.

## Procedimento futuro de manutenção

1. Aprovar o inventário de hostnames, política Access, identidade nominal do operador, MFA e permissões mínimas no plano de controle. Não usar a sessão F2 perdida como única autorização para recuperação.
2. Revisar binding D1 e origem de homologação, secretos e ausência de recursos de produção. Escopo de credenciais: somente administração do Worker de manutenção, sua configuração/secrets/agendamento e o binding D1 necessário. Granularidade real de permissões ainda precisa ser confirmada; não presumir isolamento por Worker se o provedor não o oferecer.
3. Pelo mecanismo de secrets do provedor, fornecer a nova senha e o pepper correto, sem argumentos CLI com valores sensíveis, logs, URL, storage ou arquivos versionados. O comando deve fixar ação, proprietário e versão após consulta autorizada de metadados.
4. Somente em etapa autorizada, armar a configuração e ativar temporariamente um agendamento. O canal é o plano de controle, não uma rota pública de recuperação. M3D.1 não executa esse passo nem fornece uma agenda pronta.
5. Confirmar o resultado com evidência operacional e login F2. Se o resultado for desconhecido, consultar metadados de forma autorizada e verificar a senha pretendida; uma versão avançada isoladamente não identifica o comando vencedor. Não atualizar a versão e reenviar automaticamente.
6. Desarmar, remover o agendamento e o secret temporário de senha, confirmar revogação de sessões antigas após recuperação e registrar o encerramento sem segredos. Não remover o pepper necessário ao login normal da aplicação.

Conta desabilitada, perda de pepper ou comprometimento do plano de controle exigem procedimento específico aprovado. O Worker não reativa conta nem oferece bypass. O transporte operacional de consulta de metadados e a auditoria durável ainda precisam ser definidos antes da operação remota.

## Inventário obrigatório de hostnames e Access

Nenhum hostname real foi fornecido ou consultado; não foram inventados identificadores. Manter a seguinte lista em aberto até a configuração real existir:

| Entrada | Estado / condição de aceite |
| --- | --- |
| Hostname canônico da homologação | Pendente; Access cobre todo o host, inclusive `/`, assets e APIs |
| `<projeto>.pages.dev` | Projeto real pendente; proteger ou desativar o caminho alternativo |
| Aliases e URLs de branch/deploy preview | Enumerar individualmente e proteger/desativar sem herdar D1 indevidamente |
| Domínios personalizados adicionais | Nenhum aprovado; não permitir alternativa sem proteção |
| Worker de manutenção `workers.dev` / preview / routes | Desabilitados na configuração versionada; verificar efetividade futura |
| Bucket/derivados | Nenhuma URL pública; mídia remota continua desabilitada |

Access deve cobrir `/admin`, `/admin/*`, `/api/auth/*`, `/api/admin/*`, frames, mídias e assets. A autenticação F2 continua obrigatória; noindex não autoriza acesso. Não criar bypass de APIs para facilitar fetch. A proteção de um domínio personalizado não comprova proteção dos aliases Pages.

Política futura: identidades nominais autorizadas, MFA, negação por padrão e recuperação do acesso ao provedor. Sessões Access e F2 são distintas; reautenticação Access não implica revogação ou renovação automática da sessão F2. Headers Access fornecidos pelo cliente não são prova de identidade. Caso um adaptador futuro os consuma, precisará de validação criptográfica e autorização completas.

Não foi acessada documentação ou conta remota Cloudflare. Cobertura efetiva, políticas de redirect/API, compatibilidade de cron e configuração de hostnames permanecem sem homologação remota.

## Validação direcionada

| Verificação | Resultado |
| --- | --- |
| Logout/Access antes da correção | Oito novos casos vermelhos: falso sucesso, redirects não bloqueados e 401 externo tratado como expiração F2 |
| Vitest nos cinco arquivos afetados | 98 casos distintos aprovados nas execuções direcionadas, sem suíte completa |
| Navegador, somente quatro casos novos M3D.1 | 4/4, HTML 200/401/403 e redirect 302 durante PUT, exit 0 |
| Typecheck backend e frontend, `--noEmit` | Exit 0, sem build de aplicação |
| Biome da entrega | Exit 0; informação preexistente `useTemplate` no teste de mídia preservada |
| Whitespace e escopo | `git diff --check` e conferência dos arquivos novos, exit 0 |

A primeira execução dos cinco arquivos Vitest teve quatro arquivos aprovados e um caso falhando no teste de mídia, cujo stub usava código `X` em HTTP 401. O fixture foi alinhado ao contrato real F2 `UNAUTHENTICATED`, mantendo as expectativas, e somente seu arquivo foi reexecutado: 15/15. Nenhum teste legítimo foi removido ou relaxado. O stub de sessão e recibo também foi ajustado para os headers/envelope efetivamente retornados pela F2.

No navegador, a primeira execução falhou porque o teste novo procurava o texto de status dentro do alert. O seletor foi corrigido para o aviso já existente `Não conseguimos confirmar`, sem mudar a interface. Os quatro casos então confirmaram texto preservado, bloqueio de novo salvamento, um único PUT, consulta manual de recibo com o mesmo operationId e storage vazio. Vite dev com APIs simuladas, sem build, D1, R2 ou migrations. Configuração/resultados em `%TEMP%/chopp-cms-m3d1/`.

Os testes do Worker validam a fronteira de agendamento, configuração, forwarding de versão, concorrência/repetição sem refresh e logs sanitizados. **Os helpers F2 são mocks nesses testes**: não há nova demonstração D1/SQL de atomicidade. As garantias persistentes permanecem as do núcleo M3C já aprovado, que não foi alterado. Essa separação evita aplicar migrations nesta rodada. Não foi executado E2E real ou teste de infraestrutura Cloudflare.

## Graphify, escopo e preservação

Skill Graphify e skills de alteração mínima/validação direcionada consultadas. Travessia somente leitura do grafo existente (2.085 nós, sete sementes, 97 relações incidentes), confirmada no código para authConfig, guards, cookies, bootstrap, gateway e gate de mídia. Não se regenerou o grafo nem se alterou seu cache/configuração.

Novas dependências: clientes administrativos → helper HTTP puro; Worker separado → bootstrap/http/recovery F2. Nenhum ciclo introduzido, nenhum import novo de server no frontend. O Worker não está no grafo antigo; seus imports e ausência de entrada em Functions foram conferidos diretamente.

Backend F2 existente, contratos, migrations, repositórios CMS, homepage, plano M3B e arquivos externos protegidos preservados. Não há novo binding R2/Images ou mecanismo de publicação. Manifesto exclusivo SHA-256 e snapshot de preservação: `%TEMP%/chopp-cms-m3d1/`. Índice Git vazio, sem commit.

## Veredito

**GO para consolidação local M3D.1. NO-GO para operação remota** até aprovar e validar inventário Access, permissões e bindings, secrets, auditoria/consulta de metadados e procedimento de manutenção. Nenhuma configuração desta entrega deve ser tratada como ambiente remoto operacional.

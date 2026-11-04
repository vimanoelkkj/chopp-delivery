# CMS M3C — preparação do acesso administrativo remoto

## Estado da entrega

Branch `integration/immersive-cms-f4a`; baseline `f5fdc565cd591fa2b68d757c59b1ced94c154882`.
Implementação e testes somente locais, sem contas ou credenciais reais, recursos remotos, migrations remotas, publicação ou commit.

**GO para consolidação local da preparação M3C. NO-GO para ativação administrativa remota.** A F2 foi reutilizada; não foi criado outro login, um endpoint de bootstrap/recovery ou uma alegação de que Access já protege a aplicação. O plano M3B permanece desabilitado e inalterado.

## Modelo de acesso privado proposto

A F2 continua sendo a autenticação administrativa da aplicação. Um controle externo de entrada deve tornar toda a homologação privada, incluindo assets, `/admin`, APIs, frame, domínio Pages padrão e URLs de preview. A origem HTTPS canônica deve ser única e estável, com D1 exclusivo e pepper exclusivo. Produção não herda recursos da homologação.

Cloudflare Access é a opção proposta para essa entrada privada, com política nominal de operadores, MFA e recuperação do acesso ao próprio provedor. Isso depende de decisão e configuração futuras. Não basta proteger um domínio personalizado e deixar outro hostname ou branch preview acessível. A capacidade real de cobrir todos esses caminhos deverá ser verificada remotamente; não foi presumida nesta entrega.

A presença de `Cf-Access-Authenticated-User-Email`, `Cf-Access-Jwt-Assertion` ou outro header recebido do cliente não autoriza a F2 nem operações de manutenção. Caso um adaptador futuro consuma identidade Access, deverá verificar assinatura, emissor, audiência, validade temporal e autorização do operador contra configuração aprovada. M3C não implementa um verificador parcial nem confia em um booleano fornecido pelo chamador como prova de identidade.

`ADMIN_ENABLED` é seleção do bundle por modo de build, não uma proteção de backend. A configuração remota deve usar o release administrativo `dist-release`; o build público e a homepage não mudaram. O shell estático pode conter código de login; nenhum rascunho deve entrar no HTML ou bundle. Noindex e CSP são defesa complementar, não autorização.

## Garantias existentes F2 confirmadas

| Mecanismo | Código responsável | Evidência local |
| --- | --- | --- |
| Origem exata e HTTPS fora de loopback | `server/auth/http.ts:authConfig` | Origem divergente, HTTP remoto, caminho extra e pepper inválido recusados. |
| Cookie remoto e sessão | `server/auth/session.ts` | `__Host-delegas_admin_session`, Secure, HttpOnly, SameSite=Strict, Path=/, sem Domain; token persistido apenas como hash. |
| Isolamento | `currentAdmin` / D1 | Token não funciona em outra origem nem outro banco; cookie local não autentica a sessão HTTPS. |
| CSRF | `validWriteOrigin` / handlers | Logout cross-origin, cross-site e sem Origin/Referer recusado, sem revogar a sessão legítima. O fallback atual de Referer da mesma origem permanece preservado. |
| Logout e revogação | `handleLogout`, trigger `admin_credentials_changed` | Token perde validade após logout e após recuperação; troca de senha incrementa `auth_version`. |
| Criptografia e rate limit | `password.ts`, `rate-limit.ts` | PBKDF2/HMAC e limites F2 preservados. Teste de runtime existente passou; limites não foram reimplementados nem alterados. |

O nome `__Host-` impede cookie Domain em navegadores conformes, mas não substitui isolamento D1/origem. O runtime deve definir `ADMIN_ORIGIN` e pepper por ambiente; não inferir origem de headers encaminhados nem usar wildcard. A confiança de `CF-Connecting-IP` no rate limit remoto pressupõe entrada Cloudflare válida, ainda dependente da configuração futura.

## Bootstrap remoto definido, ainda sem transporte

1. Aprovar origem canônica, isolamento de D1, política de operadores, proteção de todos os hostnames e secret de runtime. O identificador do proprietário e a senha são definidos explicitamente pelo responsável; não há padrão nem geração de credenciais reais em M3C.
2. Disponibilizar futuramente um canal de manutenção privado separado das rotas públicas normais. Proposta: serviço de manutenção sem rota pública, invocado apenas por um adaptador operacional autenticado e autorizado. A composição concreta com Access/service binding e a evidência de operador permanecem decisões pendentes. Um binding, isoladamente, não identifica o usuário operador.
3. Esse adaptador deve validar ambiente/DB de destino, identidade e autorização do operador, método/origem e limites de corpo/tempo/rate, sem aceitar o pepper pelo cliente. Credenciais só trafegam por HTTPS autenticado, nunca em URL, logs, storage, argumentos CLI ou arquivo versionado.
4. O núcleo **compartilhado** `bootstrapOwner` cria o proprietário somente se a tabela estiver vazia. Não contém pressuposto de localhost; usa o algoritmo F2 e a restrição singleton existente. O comando `scripts/bootstrap-admin.mjs`, que é exclusivo de loopback, NÃO será reutilizado nem receberá um `--remote` nesta entrega.
5. A inserção condicional e a restrição singleton protegem concorrência; jamais usar bootstrap para substituir uma conta já existente. Resposta perdida deve levar a consulta autenticada de metadados e verificação de login, não a criação automática de outro proprietário ou alteração de senha. A autorização do canal de bootstrap deve ser encerrada após conclusão; a condição SQL sozinha não substitui essa política.

**Bloqueador:** ainda não existe esse canal autorizado, configuração Access, identidade operacional ou bootstrap remoto executável. Não há rota pública de bootstrap a habilitar por variável. M3C prepara o núcleo e o procedimento, não declara essa dependência resolvida.

## Recuperação implementada no núcleo F2

`server/auth/recovery.ts:recoverOwnerCredentials` é uma primitiva interna, sem import por qualquer rota, script executável ou frontend. Ela **não autentica o operador**. Seu futuro chamador precisa ser o canal de manutenção previamente autorizado; conectá-la diretamente a HTTP seria uma vulnerabilidade e está fora desta entrega.

Entrada: ID e username atuais, `expectedAuthVersion` e nova senha. O pepper vem exclusivamente do secret de runtime do futuro serviço. Validação de credenciais foi extraída de `bootstrap.ts` sem mudar as regras existentes: identificador válido, senha entre 15 e 128 pontos de código e até 512 bytes; hash F2 existente.

A função executa uma única instrução parametrizada:

- UPDATE somente do `password_hash` quando ID, username, conta ativa e versão esperada coincidirem.
- O trigger histórico `admin_credentials_changed` incrementa `auth_version` e elimina todas as sessões da conta na mesma instrução/transação.
- Não muda ID, username, estado ativo, histórico editorial, mídia ou recibos. Não cria uma conta nova e não reativa uma conta desabilitada.
- `true` confirma o UPDATE; `false` significa precondição não satisfeita, sem distinguir ausência, conflito ou tentativa já superada. Erros SQL são propagados. Não há retry automático ou novo sistema de recibos.
- Duas recuperações com a mesma versão têm no máximo uma vencedora. Repetir uma versão já consumida não regrava a senha. Isso é proteção CAS, **não** um recibo idempotente capaz de recuperar a resposta original.

### Procedimento futuro de recuperação

1. Recuperar primeiro o acesso ao provedor/Access por seu processo operacional aprovado. Perda simultânea desse acesso é um bloqueador; não desabilitar F2/CSRF nem abrir um bypass público.
2. Pelo canal privado de manutenção, autenticar e autorizar nominalmente o operador, aprovar o incidente e confirmar ambiente e proprietário. Ler somente metadados necessários no servidor; não entregar hashes ou tokens ao cliente.
3. Obter versão atual e uma nova senha definida pelo responsável, sem registrá-la. Executar a primitiva com essa versão. Se houver conflito, parar, investigar a mudança e exigir nova decisão explícita; não atualizar a versão e reenviar automaticamente.
4. Com resposta perdida, tratar o resultado como inconclusivo. Consultar metadados pelo canal autorizado e verificar login F2 com a senha pretendida. Uma versão avançada, isoladamente, não prova que este comando venceu. Não disparar outra redefinição automática.
5. Confirmar login com a nova senha e invalidação dos tokens antigos. Registrar ator, ambiente, horário e resultado em auditoria operacional sem segredo, encerrar o incidente e o acesso excepcional. Persistência dessa auditoria e autenticação do canal ainda não existem no produto.

Este fluxo evita SQL manual no banco de produção. Ele não é uma operação atualmente acessível pelo painel. Conta desabilitada, perda do pepper ou suspeita de comprometimento exigem outro procedimento aprovado. Rotacionar o pepper cegamente invalidaria verificações de senha; M3C não implementa rotação/restauração de secrets nem promete recuperação nesse caso.

## Configuração e secrets por ambiente

| Item | Laboratório | Homologação futura | Produção |
| --- | --- | --- | --- |
| D1 | Fixture descartável ou configuração local existente | Banco exclusivo, identidade conferida pelo canal de manutenção | Outro banco, fora do escopo |
| `ADMIN_ORIGIN` | Loopback explícito | Origem HTTPS canônica exata, ainda não definida | Origem própria, não herdar homologação |
| `ADMIN_PASSWORD_PEPPER` | Valor de teste ou configuração local existente | Secret exclusivo de runtime, 64 hex, custódia e recuperação aprovadas | Secret exclusivo, fora do escopo |
| `ADMIN_ALLOW_INSECURE_LOCAL` | Permitido apenas no loopback existente | Ausente | Ausente |
| `CMS_MEDIA_LOCAL` | Somente laboratório descartável | Ausente; mídia remota continua bloqueada | Ausente |
| Canal de manutenção / política privada | Somente testes diretos do núcleo | Não provisionado; autorização e mecanismo de identidade pendentes | Nenhuma ativação |

Nenhum novo secret do tipo senha padrão, token de bootstrap ou senha de recuperação foi introduzido. Os exemplos `.example` e credenciais nos testes são fixtures locais; `Request`/handlers são executados em processo e não fazem fetch a esses domínios.

## Separação de capacidades

A preparação de autenticação não altera o gate `localMediaEnabled`: mesmo com sessão HTTPS válida e flags de laboratório acidentais, a listagem de mídia continua 404 fora de loopback. Não foram acrescentados bindings R2/Images, endpoints ou tratamento de publicação. Contratos, migrations 0001–0010, repositórios CMS, homepage e plano M3B permanecem intactos. O fato de autenticar o administrador não promove rascunho nem conecta CMS ao frontend público.

## Testes e validação proporcional

Novo arquivo: `tests/backend/auth-remote-admin.test.ts`, 10 cenários. Todos usam D1 do `authFixture` com `d1Persist:false`; migrations históricas são aplicadas somente nessa fixture efêmera, sem Wrangler remoto e sem banco mantido.

- Login HTTPS, flags do cookie, hash do token, no-store e logout.
- Headers Access falsificados não substituem sessão F2.
- CSRF negativo com sessão preservada após recusa.
- Isolamento por origem, banco e nome do cookie.
- HTTP remoto, origem não canônica/divergente e pepper inválido.
- Mídia permanece indisponível na origem HTTPS.
- Recuperação troca senha, preserva proprietário e revoga sessões; senha antiga falha e nova autentica.
- Concorrência e replay de versão consumida não sobrescrevem credenciais.
- Identidade errada e conta desabilitada não são alteradas.
- Input inválido não escreve; falha injetada no trigger de exclusão de sessões aborta também troca de senha, mantendo login/token anteriores válidos.

Demonstração antes da implementação: o cenário positivo executado contra uma implementação sem efeito falhou em `expected false to be true`. Depois, os dez cenários passaram. A primeira tentativa anterior também identificou o módulo ainda inexistente; essa falha de import não é tratada como prova comportamental.

Resultados:

| Comando | Resultado |
| --- | --- |
| `npm test -- tests/backend/auth-remote-admin.test.ts tests/backend/auth-bootstrap.test.ts tests/backend/auth-cookie.test.ts --maxWorkers=1` | 19/19, exit 0 |
| `npm test -- tests/backend/auth-runtime.test.ts --maxWorkers=1` | 2/2, exit 0; compatibilidade CLI/Node e workerd |
| `node node_modules/typescript/bin/tsc -p tsconfig.backend.json --noEmit` | Exit 0 após corrigir apenas a anotação de tipos dos casos negativos |
| Biome nos três arquivos TS afetados | Exit 0 |
| `git diff --check` e whitespace da entrega | Exit 0 |

Não foram executados Vitest completo, Playwright, E2E reais nem builds. A entrega não comprova TLS/cookies no navegador remoto, Access, mecanismo de manutenção, propagação de configuração ou disponibilidade real Cloudflare.

## Graphify e preservação

Skill Graphify consultada; busca BFS no grafo existente de 2.085 nós, com vocabulário confirmado `bootstrap auth session cookie origin password`. Referências relevantes: `password.ts`, `bootstrap-admin.mjs`, `session.ts`, `auth/http.ts`, `auth/handlers.ts`, `guard.ts` e fixtures. Saída truncada por orçamento; conferência direta de SQL/TS prevaleceu. Nenhuma regeneração ou configuração/hooks alterados.

Novo acoplamento local: `recovery.ts → bootstrap.ts → password.ts`, e `recovery.ts → password.ts`; não cria ciclo. A extração da validação não muda a dependência de `bootstrap.ts`. A nova primitiva só é importada pelo teste M3C; o grafo existente não contém esse novo nó e não foi usado como evidência de uma indexação inexistente. Nenhum import novo em Functions, React ou runtime normal.

Hashes de preservação e manifesto da entrega em `%TEMP%/chopp-cms-m3c/`. Arquivos protegidos, correção CP0 e grafo estrutural preservados; apenas `graphify-out/cache/last_query_stamp` pode mudar pela consulta operacional. Índice vazio e nenhum commit criado.

## Pendências e veredito

**GO para consolidação local da fundação M3C**, com quatro arquivos e sem exposição de novas capacidades remotas. **NO-GO para bootstrap/recuperação remotos operacionais** até implementar e auditar canal autorizado, política privada de todos os hostnames, gestão/recuperação de secrets, auditoria e testes reais em homologação isolada. Essas pendências não podem ser resolvidas adicionando um header confiável por convenção ou uma flag de localhost no remoto.

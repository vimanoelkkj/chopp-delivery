# F2 — infraestrutura de autenticação administrativa

Esta fase oferece somente autenticação/guard do proprietário. Não cria interface de
login, painel, CRUD, gestão de contas ou recuperação automática de senha.
O catálogo público e as migrations 0001/0002 permanecem intactos.

## Módulos e limites de confiança

- `functions/api/auth/{login,logout,me}.ts`: entradas reais Pages Functions.
- `server/auth/handlers.ts`: métodos HTTP, validação, rate limit e respostas.
- `http.ts`: configuração fechada, origem, JSON limitado a 2048 bytes reais e headers.
- `password.ts`: Web Crypto para KDF, MAC, aleatoriedade e hashes de tokens.
- `session.ts`: cookies, criação condicional, sessão ativa e prova SQL de escrita.
- `guard.ts`: autenticação explícita de futuras rotas, com CSRF nas escritas.
- `rate-limit.ts`: reservas atômicas de tentativas em D1, sem contador em memória.
- `bootstrap.ts` e `scripts/bootstrap-admin.mjs`: somente primeira conta local.

O único binding de dados é `DELEGAS_DB`. Consultas de autenticação usam o D1
primário normal, sem sessões de réplica que possam ler estado anterior à revogação.
Todos os valores variáveis usam placeholders/bind; não há permissões vindas do cliente.

## APIs

| Endpoint | Entrada | Sucesso | Falhas principais |
|---|---|---|---|
| `POST /api/auth/login` | JSON com exatamente `username` e `password`, ambos strings; Origin válido | 200 `{ authenticated: true, user: { id, username } }` e Set-Cookie | 400 estrutura/corpo, 401 credenciais, 403 origem, 429 limite, 503 infraestrutura |
| `POST /api/auth/logout` | Cookie opcional e origem obrigatória; corpo ignorado | 200 `{ ok: true }`, revogação do token apresentado e cookie expirado | 403 origem, 503 infraestrutura |
| `GET /api/auth/me` | Cookie da sessão | 200 com a mesma representação pública do usuário | 401 sessão inválida, 503 infraestrutura |

Métodos diferentes dos listados retornam 405 com `Allow`; HEAD não devolve corpo.
Todas as respostas têm `Cache-Control: no-store`, `nosniff` e `X-Frame-Options: DENY`.
Não há CORS aberto. Senhas, pepper, hashes e tokens não aparecem em JSON ou logs.
O token necessariamente é transmitido apenas pelo Set-Cookie e Cookie HTTP.
Falhas internas registram somente o código fixo `AUTH_UNAVAILABLE`.

Login rejeita JSON malformado, null, arrays, primitivos, campos extras, tipos incorretos,
UTF-8 inválido e corpos acima de 2048 bytes, mesmo com Content-Length falsificado.
Username é validado como ASCII antes de converter para minúsculas (login e CLI):
3–64 caracteres `[a-z0-9._-]`, começando com letra/número. `Kelvin`, por exemplo,
é rejeitado, embora o lowercase Unicode convertesse `K` em `k`.
Login aceita senha de 1–128 caracteres, até 512 bytes;
bootstrap exige 15–128 caracteres, até 512 bytes, sem regras artificiais de composição.
Não há senha padrão. Ausência/desativação de usuário executa a mesma derivação
dummy e retorna o mesmo 401 de uma senha incorreta, sem indicar existência de conta.

## Derivação de senha e limite do runtime

Formato versionado: `pbkdf2-sha256-hmac-v1$100000$salt_hex$mac_hex`.
Web Crypto PBKDF2-HMAC-SHA256 usa 100000 iterações, salt aleatório de 16 bytes e
resultado de 32 bytes. Um HMAC-SHA256 posterior usa um pepper aleatório de 32 bytes,
guardado exclusivamente na configuração/secrets, nunca no D1. A verificação usa
`crypto.subtle.verify`, evitando comparação textual de segredo. Custos rebaixados
ou formatos malformados são recusados, executando trabalho dummy para a falha.

**Tradeoff explícito:** 100000 é abaixo das 600000 iterações recomendadas pela
[OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
O limite padrão do runtime implantado ainda restringe PBKDF2; a proposta de elevá-lo
está [na PR workerd #7550](https://github.com/cloudflare/workerd/pull/7550).
O workerd aberto usado localmente pode aceitar custos maiores; isso não prova
suporte no runtime implantado. A F2 não faz chamadas remotas para descobrir esse limite.
O teste de runtime comprova PBKDF2 100k e MAC interoperável entre Node e workerd.

O pepper protege contra vazamento isolado do D1; se D1 e pepper forem comprometidos
juntos, a resistência a guesses continua sendo 100k. Não se afirma equivalência a
600k. Antes de publicar, confirmar limite e orçamento CPU do plano e reavaliar custo.
Perder o pepper impede novos logins. Rotacioná-lo exige redefinir a credencial e
revogar sessões em procedimento explícito futuro; não há recuperação automática.

## Sessões, cookies e CSRF

Token: 32 bytes aleatórios de `crypto.getRandomValues`, codificados como 64 hex.
D1 guarda somente SHA-256 do token, com TTL absoluto de 8 horas e origem emissora.
Não há renovação automática. A criação faz `INSERT ... SELECT` condicionado à
conta ainda ativa, ao mesmo password hash e à mesma `auth_version` verificados.
Desativação, reativação, mudança de username ou senha incrementam a versão via
trigger D1 e excluem sessões. Reativar não ressuscita tokens antigos. A leitura
também exige conta ativa, versão atual, origem correspondente e prazo vigente.
Logout revoga somente o token apresentado; ausência/token inválido/segunda chamada
continuam retornando 200. Isso não concede acesso administrativo.

| Ambiente | Cookie | Proteções |
|---|---|---|
| HTTPS/produção | `__Host-delegas_admin_session` | Secure obrigatório, HttpOnly, SameSite=Strict, Path=/, sem Domain |
| HTTP local explícito | `delegas_admin_local_session` | HttpOnly, SameSite=Strict, Path=/, sem Domain |

HTTP sem Secure só é aceito se **ambos** forem verdadeiros: `ADMIN_ALLOW_INSECURE_LOCAL=1`
e `ADMIN_ORIGIN` for exatamente HTTP em localhost/127.0.0.1. A flag não permite
HTTP em domínio remoto; mesmo com a flag, HTTPS usa o cookie Secure de produção.
Origem/configuração incompleta ou divergente falha fechada. Cookies da R&P e o
cookie local não são considerados cookies de produção; outro banco não autentica
a sessão. Cookies não têm isolamento por porta: nomes próprios, host-only e a
origem armazenada no D1 fazem a separação necessária entre aplicações locais.

Escritas exigem Origin exatamente igual a `ADMIN_ORIGIN`. Se Origin estiver
ausente, um Referer válido e da mesma origem é aceito. Origin inválido/`null`
não usa fallback de Referer. Ambos ausentes => 403; Fetch-Site cross-site => 403.
A origem da URL recebida também deve corresponder à origem configurada.
Origem válida **não** autentica um administrador.

## Guards e futuras escritas

Cada rota protegida deve chamar `requireAdmin(request, env)` e devolver `error`
antes de executar qualquer ação. O resultado público autorizado é `principal.user`;
não serialize `principal.sessionHash` ou a configuração.

Para mutações futuras, chamar o guard não basta para evitar corrida com revogação.
`adminWriteProof(principal, config)` fornece SQL constante e parâmetros que precisam
compor **o WHERE do próprio UPDATE/DELETE/INSERT SELECT**, via `.bind(...)`.
O D1 reavalia sessão, conta ativa, versão, origem e expiração no instante da escrita;
zero linhas alteradas exige negar a ação. Não use um SELECT prévio separado como
substituto. Nenhum endpoint de CRUD foi criado na F2: as provas são exercitadas
somente contra dados de testes descartáveis.

Na F2.1, os parâmetros da prova são uma tupla readonly, evitando alterações
acidentais e preservando sua ordem. Isso não impede esquecer o predicado ou tratar
zero alterações como sucesso. Para a F3, recomenda-se encapsular cada mutação em
um repositório que receba o resultado autorizado do guard, componha predicado e
binds e negue zero alterações. Não foi criado um executor genérico de SQL nem uma
refatoração ampla antes de existirem as mutações reais.

## Rate limiting persistente

Política F2.1: 20 tentativas por IP/15 minutos, **10 por combinação username/IP**
e 100 globais/15 minutos. O antigo limite de 10 por username entre todos os IPs
foi substituído explicitamente: um IP não pode bloquear a conta em outra rede.
O mesmo IP ainda pode bloquear o proprietário atrás do mesmo NAT. Não se limpa
o contador por sucesso; senhas corretas também gastam a reserva.

O corpo é lido antes da reserva conjunta para identificar o username. A leitura
tem teto de 2048 bytes reais e prazo total de 5 segundos; streams lentos são
cancelados sem aguardar a promessa de cancelamento. Corpos inválidos também
consomem IP/global quando admitidos, retornando 400; se bloqueados, retornam 429.
O prazo limita uma leitura, não a quantidade de conexões simultâneas na borda.

Uma leitura indexada prévia retorna 429 sem preparar mutações quando já há limite
esgotado. Ela é apenas uma otimização. A decisão efetiva usa um único
`INSERT ... SELECT ... ON CONFLICT` com uma CTE `AS MATERIALIZED`: verifica todos
os limites sobre o estado anterior e incrementa/reseta todos ou nenhum. A leitura
dos limites após uma disputa está no mesmo `D1Database.batch`, uma
[transação com rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
A [materialização SQLite](https://www.sqlite.org/lang_with.html#materialization_hints)
fixa a admissão antes das escritas. Testes no runtime D1 local cobrem a última vaga
de cada bucket, concorrência e falha SQL durante a reserva; upgrades do runtime
devem preservar essas regressões.

Uma recusa não cria buckets, incrementa contadores, estende janelas nem executa
limpeza. As recusas que perderam a corrida também têm zero `rows_written`,
verificado em D1 real. `Retry-After` usa o maior prazo dos limites esgotados,
arredondado para cima; na expiração exata a janela volta a admitir. Resultado
inconsistente ou falha de D1/limpeza impede o KDF e devolve 503. Uma falha após
reservar pode consumir a tentativa; não se promete reembolso transacional do login.
Os buckets são HMAC com pepper e domínio próprio; não armazenam IP/username em claro.
Em produção Pages, CF-Connecting-IP vem da borda; no loopback o bucket é fixo,
ignorando esse cabeçalho forjado. Sem IP de borda usa-se um bucket `unknown`.
Limpeza de registros vencidos é limitada a 100 linhas por tentativa admitida.
Não há nova migration; buckets antigos exclusivos por username deixam de ser
consultados e são removidos pela limpeza após expirar. Buckets IP/global existentes
continuam em vigor, sem reset ao atualizar o código.

**Tradeoffs e riscos remanescentes:**

| Opção / risco | Avaliação |
|---|---|
| Limite duro de 10 por conta entre IPs | Menos guesses distribuídos, mas qualquer atacante com o username bloqueia o proprietário. Substituído pelo limite username/IP. |
| Somente IP, sem global | Evita lockout global, mas uma botnet multiplica custo de PBKDF2 e gravações. Rejeitado. |
| Username/IP + IP + global (adotado) | Mantém dez guesses por conta/IP e no máximo 100 reservas de KDF por janela global, para todos os usernames. Um ataque distribuído pode tentar até 100 senhas contra a conta e esgotar o global. |
| Permitir senha correta acima da quota / zerar quota por sucesso | Exigiria executar KDF antes da limitação ou reabriria orçamento. Rejeitado. Sessões já emitidas continuam válidas durante um bloqueio de login. |
| Quotas D1/Workers e CPU (P2, antes de produção) | Recusas ainda gastam leituras D1, HMAC, parsing e requests. Nenhum limite D1 protege o próprio D1 contra tráfego ilimitado. Falha de quota fecha login/guards com 503; catálogo compartilha o banco e pode ser afetado. |
| Ataque distribuído / mesmo NAT / burst de janela (P2) | IP não identifica uma pessoa. Rotação de IPs esgota o global; IP compartilhado bloqueia usuários legítimos. Janelas fixas permitem burst na fronteira, até 200 admissões entre duas janelas adjacentes. |
| Controles futuros Cloudflare | Antes de publicar, avaliar WAF/rate limiting para o caminho de login e Turnstile validado no servidor, conforme disponibilidade e limites do plano. São complementos, não substitutos da reserva atômica ou da validação de sessão. Nenhum recurso/controle de borda foi criado nesta fase. |

Não há CAPTCHA, WAF, MFA ou recuperação automática implementados. Suavizar o
limite da conta sozinho não resolve DDoS nem garante disponibilidade sob botnet.
Confirmar o [orçamento/quotas D1](https://developers.cloudflare.com/d1/platform/limits/)
e a [cobrança por leituras/escritas](https://developers.cloudflare.com/d1/platform/pricing/)
do plano escolhido antes de qualquer implantação. O ensaio local não valida CPU,
quota ou comportamento de streaming da borda em produção.

## D1 e bootstrap exclusivamente local

Migration `0003_admin_auth.sql` cria `admin_users` (singleton proprietário),
`admin_sessions` (token_hash, user_id, auth_version, origin, created_at, expires_at)
e `admin_login_limits` (key, attempts, expires_at), índices e trigger de revogação.
Não contém seed de conta/senha. Migrations aplicadas da F1 não foram alteradas.

Use o Node 26.7 validado neste projeto para a CLI TypeScript nativa. Pare o servidor
Pages local durante o bootstrap para carregar o novo .dev.vars ao reiniciá-lo.
Em um PowerShell interativo, na raiz do Delegas:

```powershell
npm.cmd run db:init
npm.cmd run admin:bootstrap
npm.cmd run dev:full
```

A CLI exige `--local` (já presente no script npm), pergunta o username e duas entradas
de senha **sem eco**. Não aceita senhas por argumentos, variáveis ou pipes. Gera
`.dev.vars` com pepper aleatório via criação exclusiva e não imprime credenciais.
Esse arquivo é ignorado pelo Git; `.dev.vars.example` é somente documentação,
não deve ser copiado com pepper vazio antes do bootstrap. Não coloque valores reais
em VITE_*, README, histórico do terminal ou arquivos versionados.
No Windows, mantenha as ACLs locais restritas ao proprietário; mode 0600 é aplicado
na criação onde o sistema suporta permissões POSIX, sem prometer essa proteção no NTFS.

Para usar `localhost`, escolha explicitamente:
`npm.cmd run admin:bootstrap -- --origin http://localhost:8788`.
O host/origem escolhido deve ser o usado nas chamadas administrativas. Na F2,
as chamadas auth usam a origem Pages; o proxy Vite continua destinado ao catálogo público.

A CLI acessa somente Miniflare/D1 local, binding Delegas e `.wrangler/state/v3/d1`.
Recusa binding divergente, origem remota e conta já existente, sem redefinir senhas.
Se uma execução parar após criar .dev.vars mas antes da conta, uma nova execução
reutiliza o pepper válido. Arquivo preexistente incompleto/duplicado é recusado,
sem sobrescrita. Se a conta existir e o pepper for perdido, restaurar o segredo
por procedimento controlado; o bootstrap não cria outra conta nem contorna esse estado.
Não foi executado bootstrap de conta real ou remoto nesta implementação.

## Verificação

`npm.cmd run test:auth` cobre login positivo/negativo, cookies, limites concorrentes,
expiry/revogação, mudança de senha/ativação durante login, prova SQL após o guard,
JSON hostil, origem ausente, bootstrap concorrente, Node nativo e workerd.
Cada fixture D1 é não persistente; o teste de migrations usa diretório temporário
próprio e o remove após conferir seu caminho e marcador de propriedade.
Reexecutar migrations com Wrangler preserva dados editados e conta criada.
`tests/backend/auth-rate-limit.test.ts` acrescenta regressões dos ataques de um IP,
300 IPs com global saturado, disputas entre IPs, limite username/IP, última vaga de
cada quota, Retry-After/expiração, rollback real, username Unicode e prazo do corpo.

Rodar também typecheck, Biome, Vitest completo, `test:backend`, build, npm audit,
git diff --check e os E2E completos com `PLAYWRIGHT_CHANNEL=chrome`.
Nenhum teste da F1 foi removido ou enfraquecido. Sem dependências novas, recursos
Cloudflare, migrations remotas, interface ou CRUD nesta fase.

Riscos para revisão independente: custo KDF abaixo de OWASP por limite do runtime,
lockout temporário sob abuso, restauração/rotação manual do pepper e validação
do orçamento CPU/plataforma antes de qualquer publicação. A política de sessão
e o guard são infraestrutura; cada futura mutação deve integrar a prova SQL.

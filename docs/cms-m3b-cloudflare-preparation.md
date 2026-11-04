# CMS M3B — preparação local da homologação Cloudflare

## Baseline e limite da entrega

Branch `integration/immersive-cms-f4a`, HEAD `33ff74eaed7e070a00a8536303d3c992f3e56ebc`.
Entrega preparatória: não provisiona, não migra, não cria secrets, não faz build/deploy e não habilita mídia remota. Nenhum identificador de recurso foi inventado.

`config/cloudflare/environments.plan.json` é um **plano**, não um arquivo Wrangler. Não o passar a `wrangler --config`. Os campos `null` representam decisões e recursos não existentes; não são valores de substituição utilizáveis. Não há gerador de configuração executável nesta entrega. O validador rejeita inclusive o preenchimento antecipado desses campos: uma etapa posterior deve rever deliberadamente o plano e seus guardas.

## Arquivos e ambientes

| Ambiente | Configuração / artefato | Estado |
| --- | --- | --- |
| Laboratório | `wrangler.jsonc`; harness `scripts/dev-admin-integration.mts` | Preservado, com capacidades locais atuais. O harness cria D1/R2 descartáveis. A configuração base também atende o desenvolvimento local persistente existente; M3B não a executa. |
| Homologação | Plano novo; Pages com `pages_build_output_dir: ./dist-release`, build `npm run build:release`, validação `npm run verify:release` | Desabilitada, sem projeto, origem, D1, bucket ou processador remoto. Caminhos do plano são relativos à raiz do repositório. |
| Produção | Sem nova configuração nem recursos | Desabilitada no plano; não inferir recursos ou herdar bindings da homologação. |

O `wrangler.jsonc` existente continua apontando para `./dist` e para um identificador exclusivamente local. Não deve ser copiado para implantação remota. Não foram alterados scripts npm nem rotinas locais.

## Diagnóstico confirmado no código

- `vite.config.ts` fixa o modo release em `dist-release`; `scripts/check-release-bundle.mjs` verifica o artefato e seu relatório de fingerprints, sem reconstruí-lo. A validação M3B não afirma que um artefato antigo presente no disco esteja atualizado.
- `src/app/App.tsx` define `ADMIN_ENABLED` pelo **modo de build**. Não é uma variável de ambiente que autoriza APIs. O build normal exclui a interface administrativa; isso não equivale à remoção das Functions autenticadas.
- `server/auth/http.ts`: origem exata, HTTPS fora de loopback e pepper com 64 caracteres hexadecimais. `validWriteOrigin` recusa `Sec-Fetch-Site: cross-site`; aceita Origin correto ou Referer da mesma origem quando Origin está ausente. Essas regras foram preservadas.
- `server/auth/guard.ts` e `session.ts`: sessão validada em D1; cookie remoto `__Host-delegas_admin_session`, Secure, HttpOnly, SameSite=Strict, Path=/, sem Domain; duração atual de oito horas. A autorização das escritas é reavaliada no SQL. Nenhum token deve entrar em URL ou bundle.
- `scripts/bootstrap-admin.mjs` aceita apenas `--local` e HTTP de loopback, validando o binding local. Não há bootstrap remoto operacional nem procedimento de recuperação/rotação aprovado. Não reutilizar credenciais ou pepper do laboratório; nenhum foi criado ou lido por M3B.
- `server/cms/media-library.ts:localMediaEnabled` exige HTTP loopback, `CMS_MEDIA_LOCAL=disposable-v1`, `ADMIN_ALLOW_INSECURE_LOCAL=1` e ambos os bindings. Listagem, recibos e derivados também passam por esse gate em `media-queries.ts`. Adicionar bindings numa configuração remota **não** habilitaria mídia: os endpoints permanecem indisponíveis. Não remover o gate nem levar as flags locais ao remoto como atalho.
- `scripts/local-image-worker.mjs` é um Worker emulado privado, utilizado apenas pelo harness com binding Images do Miniflare. Processa POST `/hero` e `/section`, retornando WebP. Não existe configuração de Worker remoto validada. Uma futura implementação privada deve respeitar exatamente o protocolo, os dois perfis e os limites de `media-contract.ts`, com o verificador atual como autoridade de integridade. Não publicar esse processador como serviço público nem pressupor disponibilidade de Images no plano/conta Cloudflare.
- `server/cms/preview-page.ts` autentica shell/frame e sobrepõe os headers de `shared/preview-security.ts`; APIs privadas usam no-store. `public/_headers` complementa o shell estático. Noindex não autoriza acesso. Cabeçalhos, fallback, iframe e cookies ainda exigem homologação remota real.
- Publicação continua recusada no contrato/API, no repositório e pelos triggers de `0009_cms_v2.sql`. Não existe consumo CMS pela homepage pública. Flags do plano são restrições documentadas, não novos mecanismos de autorização; nenhuma variável fictícia de publicação foi introduzida.

## Configuração remota proposta (ainda não executável)

1. Projeto Pages exclusivo e origem HTTPS canônica estável para homologação. Uma política de entrada privada deve cobrir todo o ambiente, inclusive assets e APIs; Cloudflare Access é uma opção a decidir, não uma proteção já instalada. Autenticação F2 continua obrigatória e independente. URLs efêmeras de preview não devem ser aceitas por um wildcard em `ADMIN_ORIGIN`.
2. D1 exclusivo, binding `DELEGAS_DB`, migrations da pasta `migrations`, sem compartilhar IDs com laboratório ou produção. Reservar também a estratégia de isolamento de previews; não permitir que branch previews escrevam no banco de homologação por herança.
3. R2 exclusivo e privado, binding futuro `CMS_MEDIA_BUCKET`, sem domínio público nem acesso público ao bucket. Isolar previews e produção. Não vincular remotamente até existir gate seguro específico de ambiente e procedimento de recuperação.
4. Processador privado futuro via `CMS_MEDIA_PROCESSOR`, sem rota pública, e capacidade real de transformação validada. Nenhum binding foi ativado em M3B.
5. Secret de runtime `ADMIN_PASSWORD_PEPPER` e variável não secreta `ADMIN_ORIGIN` exata, provisionados somente em etapa autorizada. Proibir `ADMIN_ALLOW_INSECURE_LOCAL` e `CMS_MEDIA_LOCAL`. Não usar `VITE_*` para secrets, não copiar `.dev.vars`, não colocar senha em configuração, argumentos, SQL versionado ou logs.
6. Configuração Wrangler futura na raiz, explicitamente selecionada e com `pages_build_output_dir: ./dist-release`, nunca o arquivo local padrão. Definir contexto Pages/branch e bindings sem fallback para produção. O arquivo concreto só pode ser gerado/revisado após obter IDs reais e decisões aprovadas; este plano não é aceito como substituto.

## Procedimento reproduzível

### Agora, totalmente offline

Na raiz do repositório:

```powershell
node scripts/check-cloudflare-plan.mjs
node --test scripts/check-cloudflare-plan.test.mjs
node scripts/check-cloudflare-plan.mjs --require-ready
```

O primeiro comando retorna 0 quando a **preparação** é válida. O último retorna 2 deliberadamente: prontidão remota bloqueada. Campos inesperados, configuração insegura ou tentativa de passar `--deploy` retornam 1. Nenhum desses comandos importa Wrangler, lê credenciais, escreve arquivos ou faz chamadas de rede. O script não intercepta comandos Wrangler executados manualmente e não é um controle de acesso da Cloudflare.

### Futuro, somente após autorização específica

1. Aprovar inventário de recursos separado por ambiente, origem canônica, política de acesso privado, isolamento de previews, responsáveis e orçamento. Registrar nomes/IDs reais e verificar que nenhum aponta para produção.
2. Provisionar inicialmente recursos vazios e privados, sem upload de aplicação nem conexão a dados mantidos. A criação de recursos não resolve os bloqueadores de runtime listados abaixo.
3. Implementar e auditar bootstrap remoto único e recuperação administrativa, gestão/rotação do pepper e política de revogação de sessões. Não expor uma rota de bootstrap sem proteção e não reutilizar o comando local.
4. Implementar gate remoto de mídia explícito e processador privado compatível, com testes de integridade, autorização e recuperação. Preservar o isolamento do laboratório, seus limites, recibos e históricos. Validar produto/limites/custos Cloudflare e compatibilidade do serviço Images na conta real, sem presumir equivalência com Miniflare.
5. Revisar configuração executável separada, sem placeholders, com `dist-release`, origem e bindings reais. Aprovar backup/restauração coordenados de D1/R2, observabilidade, reconciliação e rollback de aplicação compatível com schema aditivo. Nunca desfazer migrations apagando histórico.
6. Em etapa autorizada, aplicar migrations aprovadas **somente ao D1 novo de homologação** e verificar prontidão 0001–0010. Primeiro ensaiar upgrade e restauração em cópia descartável. M3B não aplica nenhuma migration.
7. Produzir `npm run build:release` e executar `npm run verify:release` sobre o mesmo `dist-release` a ser enviado, conferindo fingerprints. Selecionar explicitamente projeto, branch/contexto e configuração revisados; não usar deploy com defaults. Comandos concretos de deploy ficam para a etapa autorizada, após os identificadores existirem.
8. Validar remotamente HTTPS, proteção privada, cookie, login/logout, CSRF, sessões revogadas, API autenticada, iframe/CSP/fallback e no-store; mídia sem sessão, corrupção/ausência de objeto, concorrência, recibos e exclusão com histórico. Confirmar homepage inalterada e publicação recusada. Falha de autenticação ou acesso público a bytes privados impede avanço.

## Dependências e decisões pendentes

| Prioridade | Pendência | Critério para liberar |
| --- | --- | --- |
| P0 | Origem e política de acesso privado de todo o ambiente | Política aprovada e testável, sem exposição acidental de previews. |
| P0 | Bootstrap/recuperação remotos e gestão de secrets | Fluxo auditado que crie apenas o primeiro proprietário sem credenciais públicas. |
| P0 | Gate de mídia remoto e processador real | Compatibilidade demonstrada sem ativar bypass local ou expor bytes privados. |
| P1 | Inventário e configuração executável por ambiente | IDs reais, recursos isolados e artefato release verificado. |
| P1 | Backup/restauração, observabilidade e resposta a falhas | Ensaio em homologação isolada antes de depender do serviço. |
| P2 | Retenção de revisões e orçamento continuado | M3A permite reutilizar apenas exclusões concluídas sem referências; 100 mídias retidas por históricos ainda esgotam a capacidade. |

Não foram consultados conta, documentação remota ou preços atuais da Cloudflare. Suporte efetivo, limites, custos e comportamento remoto permanecem a validar. O plano usa os nomes de bindings e o protocolo já presentes no código, sem alegar certificação remota.

## Graphify e preservação

Consultas BFS no grafo existente (2.085 nós) localizaram `bootstrap-admin.mjs`, `localImageWorker`, `media-library.ts`, `media-queries.ts`, `auth/http.ts`, `dev-admin-integration.mts` e verificadores de bundle. Vocabulário confirmado: bootstrap, media, local, release, auth, preview, wrangler. Saídas limitadas por orçamento; não são prova exaustiva. Todas as conclusões operacionais acima foram conferidas diretamente no código. Sem update estrutural, configuração ou hooks alterados; somente `cache/last_query_stamp` pode variar por consulta.

Arquivos externos protegidos, correção CP0, migrations 0001–0010, backend, contratos, frontend e configuração local devem permanecer byte a byte como no pré-voo. Inventário e hashes de preservação em `%TEMP%/chopp-cms-m3b/before.json`; manifesto exclusivo gerado ao encerrar a entrega.

## Validação e veredito

Resultados executados:

| Verificação | Resultado / exit code |
| --- | --- |
| `node --test scripts/check-cloudflare-plan.test.mjs` | 13/13 aprovados, exit 0. Inclui artefato incorreto, ativação antecipada, ID fictício, bucket público, binding prematuro, segredo embutido, bypass local e publicação. |
| `node scripts/check-cloudflare-plan.mjs` | Preparação válida, exit 0; bloqueadores listados e prontidão falsa. |
| CLI `--require-ready` e `--deploy`, exercitados pelos testes | Exit 2 para prontidão bloqueada e exit 1 para opção proibida, respectivamente. |
| Biome nos três arquivos JSON/JS novos | Exit 0 após organizar imports do verificador; nenhuma regra desabilitada. |
| `git diff --check` e whitespace dos quatro arquivos novos | Exit 0; nenhuma alteração preparada no índice. |
| Comparação SHA-256 com pré-voo | Todos os arquivos preexistentes preservados, exceto o timestamp operacional da consulta Graphify. |

Sem Vitest completo, Playwright, E2E reais, builds, migrations ou operações remotas. Não se repetiram as validações aprovadas de M3A.

**GO para auditoria da preparação M3B. GO CONDICIONAL para uma futura etapa de provisionamento de recursos vazios e isolados**, após aprovação de inventário e política de acesso, com autorização separada. **NO-GO para implantação/ativação do CMS remoto** enquanto os P0 e a configuração executável não forem resolvidos. O plano permanece desabilitado independentemente do resultado dos testes.

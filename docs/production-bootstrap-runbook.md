# Bootstrap do primeiro administrador de produção (H10.6 / H10.9-B)

**Estado: implementado e validado só localmente. Nenhuma execução remota. Todo passo abaixo exige auditoria e autorização explícita do responsável, janela marcada e o Wrangler 4.151.0 (`npx wrangler --version`).** Os comandos foram conferidos contra o `--help` do Wrangler instalado (teste `production-bootstrap-procedure.test.ts`); não foram executados contra o Cloudflare.

## Mecanismo

- `server/auth/production-bootstrap-worker.ts`: Worker de entrada **agendada apenas** (sem `fetch`, rota, `workers.dev` ou preview). Reutiliza `bootstrapOwner` (política de senha 8–128 caracteres, sem senhas triviais, PBKDF2/HMAC com pepper, `INSERT … WHERE NOT EXISTS` sobre a restrição singleton). Não recupera nem altera conta.
- `config/cloudflare/production-bootstrap-worker.jsonc`: modelo **desarmado** versionado (id de D1 placeholder, sem cron).
- `scripts/production-bootstrap-config.mjs`: gera a configuração temporária **fora do repositório**, com `main` absoluto, `account_id` fixo, `database_id` real, `ADMIN_ORIGIN`, cron de um único disparo e o comando já com `commandId` UUID v4 em minúsculas e `expiresAt`. Não aceita senha nem pepper.
- `scripts/production-account-guard.mjs`: **guarda de conta**. Falha (exit 1) se `CLOUDFLARE_ACCOUNT_ID` não for a conta esperada ou se `d1 info chopp-delivery-prod-db` não devolver o nome e o UUID de produção. Somente leitura, sem imprimir credenciais.
- `scripts/production-pages-deploy.mjs`: `preflight` (somente leitura) e `deploy` do Pages com **comando fixo** (`--project-name chopp-delivery-prod --branch main --commit-hash <commit comercial>`, sem `--config`), que recusa raiz do repositório, configuração de laboratório ou de homologação, build ausente e qualquer desvio do comando.
- O Worker só age quando **todos** valem: `PRODUCTION_BOOTSTRAP_ENABLED=armed-production-v1`; ambiente `production`; origem HTTPS canônica sem `homolog` no host; comando exato com `origin` igual a `ADMIN_ORIGIN`; `expiresAt` no futuro e a no máximo **60 min**; migrations `0003` e `0012` no D1; nenhuma variável `MAINTENANCE_*`, de mídia ou local presente.
- Ações: `inspect` (somente leitura: nunca grava) e `bootstrap` (cria o primeiro administrador; se já existir, `NOT_APPLIED`).
- Desarmado, o Worker só registra `DISARMED`: não lê banco, comando nem secrets.
- Logs: só `commandId`, resultado (`INSPECTED`, `APPLIED`, `NOT_APPLIED`, `DISARMED`, `REFUSED_OR_UNCONFIRMED`) e etapa fixa. Nunca senha, pepper, hash ou erro bruto.
- `commandId` precisa ser UUID v4 **em minúsculas**; maiúsculas são recusadas. O gerador já produz o formato certo.

## Alvo fixo (não substituir)

| | |
|---|---|
| Conta Cloudflare | `7d8a62a0e64b693184975560c7cb788d` (existe uma segunda conta, **não** usar) |
| Pages | `chopp-delivery-prod` (`https://chopp-delivery-prod.pages.dev`) |
| D1 | `chopp-delivery-prod-db` = `fe4492e3-94a4-4f9a-b44c-10a39fe21bd1` |
| Backup pós-migration | `C:\Users\zzzzz\chopp-delivery-prod-h10.8.sql` |
| Nunca o alvo | D1 de homologação `e5941166-fc42-478b-b007-2c9f44e260b6` |

**Como a conta é fixada.** O Wrangler resolve a conta nesta ordem: `account_id` da configuração, depois `CLOUDFLARE_ACCOUNT_ID`, depois o cache local. A configuração do Worker gerada já traz o `account_id`. Os comandos do **Pages** e os comandos sem `--config` usam a variável de ambiente (ou o cache), por isso a variável é obrigatória e o guarda a confere antes de cada fase. Nada depende do cache.

## Pré-condições (todas antes da janela)

1. Autorização explícita do responsável e janela marcada.
2. Projeto Pages `chopp-delivery-prod` criado (sem deploy) e D1 de produção com as migrations `0001`–`0012` aplicadas (H10.8) e **zero** administradores. Nada compartilhado com a homologação.
3. Export pós-migration guardado (caminho acima, fora do repositório).
4. Branch de produção do Pages: `main` (confirmada no painel). O projeto não tem conexão Git nem deploys. O deploy sai do diretório isolado da seção 2b, nunca da raiz do repositório.
5. Senha do proprietário (8–128 caracteres, não trivial) definida pelo responsável.
6. Duas pessoas conferem a conta e o `database_id` (saída do guarda e do passo 1).

Variáveis (PowerShell, na raiz do repositório). Os valores abaixo são os fixos desta operação:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'
$Out = Join-Path $env:USERPROFILE 'chopp-prod-bootstrap'   # FORA do repositório
$Cfg = Join-Path $Out 'wrangler.production-bootstrap.jsonc'
$Origin = 'https://chopp-delivery-prod.pages.dev'
$D1Id = 'fe4492e3-94a4-4f9a-b44c-10a39fe21bd1'
function Assert-Prod {
  node scripts/production-account-guard.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Conta/D1 de producao nao confirmados. Interrompido.' }
}
Assert-Prod
```

Chame `Assert-Prod` antes de **todo** comando que altera algo (deploy, secret, exclusão). Se ele falhar, pare e não prossiga.

## Execução

### 1. Preparação desarmada e conferências (somente leitura)

```powershell
Assert-Prod
npx wrangler --version
node scripts/production-bootstrap-config.mjs --out $Out --mode prepare --origin $Origin --d1-id $D1Id
npx wrangler deploy --dry-run --outdir (Join-Path $Out 'dryrun') --config $Cfg
npx wrangler d1 info chopp-delivery-prod-db --json --config $Cfg
```

Conferir: versão `4.151.0`; o `main` resolveu (o dry-run gera o bundle); o `id` do `d1 info` é igual a `$D1Id` e **diferente** do da homologação. Em seguida, leituras no D1 de produção:

```powershell
npx wrangler d1 execute chopp-delivery-prod-db --remote --config $Cfg --command "SELECT name FROM d1_migrations ORDER BY id" --json
npx wrangler d1 execute chopp-delivery-prod-db --remote --config $Cfg --command "SELECT count(*) AS administradores FROM admin_users" --json
```

Esperado: migrations `0001`–`0012` e `administradores = 0`. Qualquer outro resultado é **NO-GO**.

### 2. Deploy desarmado e secrets

O pepper é **gerado aqui, em memória**, e nunca exibido, gravado em arquivo nem passado como argumento. O mesmo `$Pepper` alimenta os dois secrets, o que garante valores idênticos. Um valor recém-gerado por CSPRNG de 256 bits difere do da homologação; o pepper da homologação **não é lido nem modificado**. Não use `Start-Transcript` nesta sessão.

**Como o valor chega ao Wrangler (e por que não por pipeline).** O `wrangler secret put` e o `wrangler pages secret put` só leem o valor do `stdin` quando ele **não é um terminal** (`process.stdin.isTTY` falso); caso contrário abrem o prompt `Enter a secret value`, e o Wrangler só remove espaços e quebras de linha **finais** do que lê. No PowerShell 5.1 o envio por pipeline falha de duas formas, ambas reproduzidas localmente: (1) um scriptblock chamado com `&` **não repassa** o pipeline ao programa nativo (o filho recebe 0 bytes, herda o console e abre o prompt); (2) mesmo repassando com `$input |`, o PowerShell entrega **BOM UTF-8 + valor + CRLF** (`ef bb bf … 0d 0a`), e o BOM ficaria dentro do pepper (o Worker recusaria a configuração e o Pages responderia 503 no login). Por isso o `Send-Secret` abaixo **não usa pipeline**: inicia o `node` com o `wrangler.js` por .NET, com o `stdin` redirecionado (nunca é terminal, então nenhum prompt pode abrir), grava os **bytes exatos** do valor (UTF-8 sem BOM, sem quebra de linha), fecha o `stdin`, e **interrompe** o procedimento se o processo pedir o prompt, sair com erro ou passar do limite de tempo. Os argumentos levam só nomes, nunca o valor.

```powershell
Assert-Prod
npx wrangler deploy --config $Cfg
```

```powershell
# [pepper-gerar]
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$Pepper = ConvertTo-SecureString $hex -AsPlainText -Force
[Array]::Clear($bytes, 0, $bytes.Length)
Remove-Variable bytes, hex, rng
```

```powershell
# [send-secret]
$Wrangler = Join-Path (Get-Location) 'node_modules\wrangler\bin\wrangler.js'
function Send-Secret {
  param(
    [Parameter(Mandatory)][securestring]$Secure,
    [Parameter(Mandatory)][string[]]$WranglerArgs,
    [int]$TimeoutSeconds = 120
  )
  if ($Secure.Length -eq 0) { throw 'Segredo vazio. Interrompido.' }
  if (-not (Test-Path -LiteralPath $Wrangler)) { throw 'wrangler.js nao encontrado: rode da raiz do repositorio.' }
  if ($WranglerArgs | Where-Object { $_ -match '"' }) { throw 'Argumento invalido.' }
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command node -ErrorAction Stop).Source
  $psi.Arguments = (@($Wrangler) + $WranglerArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $bytes = $null
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $bytes = (New-Object Text.UTF8Encoding $false).GetBytes($plain)
    $plain = $null
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.BaseStream.Flush()
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    $proc.StandardInput.Close()
  }
  if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
    $proc.Kill()
    throw "Tempo esgotado ($TimeoutSeconds s). Processo encerrado. Interrompido."
  }
  $proc.WaitForExit()
  $text = ($outTask.Result + $errTask.Result).Trim()
  if ($text -match 'Enter a secret value') { throw 'O Wrangler abriu o prompt interativo. Interrompido.' }
  if ($proc.ExitCode -ne 0) { throw "O Wrangler falhou (codigo $($proc.ExitCode)): $text" }
  Write-Host $text
}
```

```powershell
Assert-Prod
Send-Secret $Pepper @('secret', 'put', 'ADMIN_PASSWORD_PEPPER', '--config', $Cfg)
Send-Secret $Pepper @('pages', 'secret', 'put', 'ADMIN_PASSWORD_PEPPER', '--project-name', 'chopp-delivery-prod')
$Pass = Read-Host 'Senha do proprietario (8 a 128 caracteres)' -AsSecureString
Send-Secret $Pass @('secret', 'put', 'PRODUCTION_BOOTSTRAP_PASSWORD', '--config', $Cfg)
npx wrangler secret list --config $Cfg
npx wrangler pages secret list --project-name chopp-delivery-prod
```

**Retomada com o `$Pepper` já gerado** (sessão ainda aberta): **não** gere outro. Confira, sem exibir o valor, que ele existe e tem 64 caracteres, execute o bloco `# [send-secret]` acima (ele substitui a função antiga) e só então o bloco de envio:

```powershell
if (-not ($Pepper -is [securestring]) -or $Pepper.Length -ne 64) { throw 'Pepper ausente ou invalido: gere de novo (so antes do APPLIED).' }
```

Se o `Send-Secret` lançar qualquer erro, **nada** deve ser considerado instalado: confira com `secret list` (só nomes) e repita só o envio que falhou. Instalar o mesmo secret duas vezes só o substitui pelo mesmo valor.

Esperado: o Worker lista `ADMIN_PASSWORD_PEPPER` e `PRODUCTION_BOOTSTRAP_PASSWORD`, e o Pages lista `ADMIN_PASSWORD_PEPPER` (só nomes, nunca valores). Se a sessão do PowerShell fechar **antes** de os dois secrets do pepper estarem gravados, gere de novo e grave os dois outra vez; **depois do `APPLIED`, nunca regenere nem troque o pepper** (a conta deixaria de entrar). Um pepper com caractere inválido não passa na validação de 64 hex e o Worker recusa antes de gravar.

### 2a. Atualizar o Worker já publicado (política de senha 8–128, H10.10-B)

O Worker publicado embute o `bootstrapOwner` da época do deploy. Quem publicou antes da H10.10-B ainda tem o mínimo de **15** caracteres no código; uma senha de 8 a 14 seria recusada (`credentials_validation`) mesmo com tudo certo. Antes de armar, republique o Worker **desarmado**, com o mesmo `$Cfg` (`PRODUCTION_BOOTSTRAP_ENABLED = "disabled"`, sem `triggers.crons`). Os secrets já instalados permanecem; nada é regerado.

```powershell
Assert-Prod
npx wrangler deploy --dry-run --outdir (Join-Path $Out 'dryrun') --config $Cfg
Select-String -Path (Join-Path $Out 'dryrun\*.js') -Pattern 'PASSWORD_MIN_CHARS = 8'   # deve achar 1 linha
```

Só depois, com autorização explícita:

```powershell
Assert-Prod
npx wrangler deploy --config $Cfg
npx wrangler deployments list --config $Cfg
npx wrangler secret list --config $Cfg
```

Esperado: nova versão no topo de `deployments list`, `secret list` com os mesmos nomes de antes, nenhum cron e nenhuma rota. Não instale a senha do proprietário nem arme o Worker neste passo.

### 2b. Deploy de produção do Pages

**Release do Pages e a política de senha F2 (H10.10-C).** O Pages **não** embute o bootstrap, a recuperação nem o mínimo de senha: o bundle de Functions compilado do commit comercial e o da árvore atual diferem só por um comentário de caminho temporário, e o login aceita 1–128 caracteres nos dois. A política 8–128 vale apenas no Worker `chopp-production-bootstrap` (passo 2a), que é publicado da árvore de trabalho. Por isso o release do Pages é independente do bootstrap: o commit a publicar é sempre o SHA completo informado em `--commit` (validado por `checkReleaseCommit`: precisa ser igual à base inclusiva `COMMERCIAL_COMMIT` ou descender dela, e ser HEAD ou ancestral de HEAD; o mesmo SHA pode ser reutilizado para trocar perfis), e o bootstrap não exige commit novo do Pages. O único arquivo fora do Git do release é `wrangler.production.jsonc`, agora fixado por hash no script.

O `wrangler pages deploy` **não aceita `--config`** e lê só o `wrangler.json`, `wrangler.jsonc` ou `wrangler.toml` do **diretório atual**. O `wrangler.jsonc` da raiz do repositório é a configuração de laboratório (D1 `delegas-local-only`, sem `ADMIN_ORIGIN`): um deploy feito da raiz enviaria esses bindings. Por isso o deploy sai de um **diretório temporário, fora do repositório**, criado por `git archive` do commit comercial exato, com `wrangler.production.jsonc` copiado como `wrangler.jsonc`. Os bindings (`DELEGAS_DB`) e variáveis (`ADMIN_ORIGIN`) vão no próprio deploy, a partir desse arquivo; o secret `ADMIN_PASSWORD_PEPPER` é do projeto (passo 2). Com `--branch main` (a branch de produção, confirmada no painel) o deploy é de **Production**; qualquer outra branch vira *preview*, sem D1 nem variáveis.

Execute depois do passo 2 (secrets) e antes do passo 3. Preparar o diretório (a partir da raiz do repositório; o `wrangler.production.jsonc` revisado vem da árvore de trabalho, pois não está no commit):

```powershell
$Commit = '<SHA-1 completo do commit comercial aprovado, em minúsculas>'
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw 'Informe o SHA-1 completo do commit comercial aprovado.' }
$Deploy = Join-Path $env:USERPROFILE 'chopp-prod-deploy'   # FORA do repositório; não pode existir
$Tar = Join-Path $env:USERPROFILE 'chopp-prod-deploy.tar'
if (Test-Path $Deploy) { throw 'Diretorio de deploy ja existe: faca a limpeza e recomece.' }
if ((git rev-parse --verify "$Commit^{commit}") -ne $Commit) { throw 'Commit comercial nao confere.' }
New-Item -ItemType Directory $Deploy | Out-Null
git archive --format=tar -o $Tar $Commit
& "$env:SystemRoot\System32\tar.exe" -xf $Tar -C $Deploy
Remove-Item $Tar
Copy-Item wrangler.production.jsonc (Join-Path $Deploy 'wrangler.jsonc') -Force
cmd /c mklink /J (Join-Path $Deploy 'node_modules') (Join-Path (Get-Location) 'node_modules') | Out-Null
```

O `tar` é o do Windows (`System32\tar.exe`) por caminho absoluto: o `tar` que acompanha o Git trata `C:` como host remoto e falha. O `wrangler.production.jsonc` revisado vem da árvore de trabalho porque não está no commit.

Build comercial no diretório de deploy, com o número do WhatsApp comercial:

```powershell
Push-Location $Deploy
$env:VITE_WHATSAPP_NUMBER = '5531984400001'
npm run build:commercial
$BuildOk = $LASTEXITCODE
Remove-Item Env:VITE_WHATSAPP_NUMBER
Pop-Location
if ($BuildOk -ne 0) { throw 'build:commercial falhou. Interrompido.' }
```

Guardas prévios (somente leitura) e linha de base do D1. O `preflight` interrompe o procedimento se: a conta ou o D1 não forem os de produção; o projeto `chopp-delivery-prod` não existir; o diretório for a raiz do repositório (ou estiver dentro dela); faltar `wrangler.jsonc` ou existir `wrangler.json`/`wrangler.toml` com precedência; a configuração apontar para `delegas-local-only`, para a homologação ou para qualquer D1 que não seja o de produção; `wrangler.jsonc` diferir do `wrangler.production.jsonc` revisado ou do hash fixo `PRODUCTION_CONFIG_SHA256`; qualquer arquivo versionado do commit comercial estiver ausente ou alterado no diretório (comparação por hash de blob do Git, exceto o `wrangler.jsonc` trocado de propósito); houver `.env`, `.dev.vars` ou `graphify-out` no diretório; `dist-commercial` ou `functions/` não existirem; ou o build contiver referências de laboratório ou homologação.

```powershell
Assert-Prod
node scripts/production-pages-deploy.mjs preflight --dir $Deploy --commit $Commit
if ($LASTEXITCODE -ne 0) { throw 'Guardas do deploy falharam. Interrompido.' }
npx wrangler d1 execute chopp-delivery-prod-db --remote --json --command "SELECT (SELECT count(*) FROM admin_login_limits) AS limites, (SELECT count(*) FROM admin_sessions) AS sessoes"
npx wrangler d1 execute chopp-delivery-homolog-db --remote --json --command "SELECT (SELECT count(*) FROM admin_login_limits) AS limites, (SELECT count(*) FROM admin_sessions) AS sessoes"
```

**Anote** os dois resultados (linha de base de identidade do D1). A segunda consulta só lê a homologação.

Deploy. O script repete os guardas, recusa tudo que não seja o comando fixo abaixo (sem `--config`, só `--branch main`) e só publica com a confirmação explícita:

```powershell
Assert-Prod
node scripts/production-pages-deploy.mjs deploy --dir $Deploy --commit $Commit --confirm chopp-delivery-prod
```

O comando fixo que o script executa, com o diretório atual igual a `$Deploy` (`node scripts/production-pages-deploy.mjs command --commit $Commit` o imprime; `<SHA-1-do-release>` é o `$Commit`):

```text
npx wrangler pages deploy ./dist-commercial --project-name chopp-delivery-prod --branch main --commit-hash <SHA-1-do-release> --commit-dirty=false
```

Verificações depois do deploy (somente leitura). O domínio principal só serve deploys de **Production**:

```powershell
npx wrangler pages deployment list --project-name chopp-delivery-prod --json
curl.exe -s -o NUL -w "%{http_code}`n" https://chopp-delivery-prod.pages.dev/api/products
curl.exe -s -w "`n%{http_code}`n" https://chopp-delivery-prod.pages.dev/api/site
curl.exe -s -o NUL -w "%{http_code}`n" https://chopp-delivery-prod.pages.dev/api/auth/me
npx wrangler pages secret list --project-name chopp-delivery-prod
```

Esperado:

| Verificação | Resultado |
|---|---|
| `deployment list` | o deploy novo com ambiente **Production** e branch `main` |
| `/api/products` | HTTP **200** |
| `/api/site` | HTTP **404** e corpo com `CMS_NOT_PUBLISHED` (nenhum conteúdo editorial publicado) |
| `/api/auth/me` sem sessão | HTTP **401** (prova `ADMIN_ORIGIN` e pepper presentes; **503** indica que falta um deles) |
| `pages secret list` | só `ADMIN_PASSWORD_PEPPER` |

Qualquer divergência: **parar**, não seguir para o passo 3 e investigar. `404` no domínio principal com o deploy listado indica deploy tratado como preview. Os preços de `/api/products` e a ausência de CMS são iguais aos da homologação; essas respostas **não** distinguem o banco. A identidade efetiva do D1 é confirmada depois, no passo 5, sem escrita nossa no banco.

Limpeza do diretório de deploy (após o passo 6; remove a junção **antes** de apagar, para nunca apagar o `node_modules` do repositório):

```powershell
cmd /c rmdir (Join-Path $Deploy 'node_modules')
if ($Deploy -like '*\chopp-prod-deploy') { Remove-Item -Recurse -Force $Deploy }
```

### 3. Inspeção armada (nenhuma gravação)

Em outro terminal (com `$env:CLOUDFLARE_ACCOUNT_ID` definido), **antes** do minuto do cron, abra os logs:

```powershell
npx wrangler tail chopp-production-bootstrap --config $Cfg --format pretty
```

```powershell
Assert-Prod
node scripts/production-bootstrap-config.mjs --out $Out --mode inspect --origin $Origin --d1-id $D1Id
npx wrangler deploy --config $Cfg
```

O gerador informa o cron (UTC) do disparo e a expiração. Esperado no Tail: `INSPECTED` com `owner: null`. Qualquer outro resultado: ir ao passo 6 (desarmar) e investigar.

### 4. Bootstrap supervisionado

```powershell
Assert-Prod
node scripts/production-bootstrap-config.mjs --out $Out --mode bootstrap --origin $Origin --d1-id $D1Id --username <USUARIO>
npx wrangler deploy --config $Cfg
```

Esperado no Tail, no minuto do cron: `APPLIED`. Cada geração cria um `commandId` e uma janela novos; não reutilize arquivos de execuções anteriores.

### 5. Reconciliação

```powershell
Assert-Prod
node scripts/production-bootstrap-config.mjs --out $Out --mode inspect --origin $Origin --d1-id $D1Id
npx wrangler deploy --config $Cfg
npx wrangler d1 execute chopp-delivery-prod-db --remote --config $Cfg --command "SELECT count(*) AS administradores FROM admin_users" --json
```

Esperado: `INSPECTED` com `owner: { username, active: true, authVersion: 1 }` e `administradores = 1`. O login em `<ORIGEM>/admin` exige o deploy de produção do Pages (seção 2b); o responsável o confirma com a senha escolhida. Depois do login, a **identidade efetiva do D1** se confirma sem escrita nossa (a escrita é da própria aplicação): repita as duas consultas da linha de base da seção 2b.

```powershell
npx wrangler d1 execute chopp-delivery-prod-db --remote --json --command "SELECT (SELECT count(*) FROM admin_login_limits) AS limites, (SELECT count(*) FROM admin_sessions) AS sessoes"
npx wrangler d1 execute chopp-delivery-homolog-db --remote --json --command "SELECT (SELECT count(*) FROM admin_login_limits) AS limites, (SELECT count(*) FROM admin_sessions) AS sessoes"
```

Esperado: em **produção** `limites` e `sessoes` aumentaram em relação à linha de base (o login gravou no D1 ligado ao Pages) e na **homologação** os dois valores são **idênticos** à linha de base. Qualquer outro resultado indica binding errado: parar e tratar como NO-GO.

### 6. Desarmamento e remoção (sempre, inclusive em falha)

Primeiro remove os secrets e prova que o Worker desarmado não faz nada; depois remove o Worker. Os comandos `secret delete` e `delete` pedem confirmação; responda `y`.

```powershell
Assert-Prod
npx wrangler secret delete PRODUCTION_BOOTSTRAP_PASSWORD --config $Cfg
npx wrangler secret delete ADMIN_PASSWORD_PEPPER --config $Cfg
npx wrangler secret list --config $Cfg
node scripts/production-bootstrap-config.mjs --out $Out --mode disarm-check --origin $Origin --d1-id $D1Id
npx wrangler deploy --config $Cfg
```

Esperado: `secret list` vazio e, no Tail, `DISARMED` (sem `APPLIED` nem `INSPECTED`). Em seguida:

```powershell
Assert-Prod
npx wrangler delete chopp-production-bootstrap --config $Cfg
npx wrangler deployments list --config $Cfg
```

Esperado: a exclusão confirmada e o `deployments list` informando que o Worker não existe. Por fim, faça a limpeza do diretório de deploy (seção 2b) e limpe a sessão e os rastros: apague a pasta `$Out` e o clipboard (`Set-Clipboard -Value ' '`) se usado, e descarte qualquer registro da senha.

```powershell
Remove-Variable Pepper, Pass -ErrorAction SilentlyContinue
if ($Out -like '*\chopp-prod-bootstrap') { Remove-Item -Recurse -Force $Out }
[GC]::Collect()
```

**Não** apague o pepper do Pages.

## Pages: como o deploy aplica a configuração (referência)

Comportamento confirmado no código do Wrangler 4.151.0 (H10.9-C) e fixado pelos testes:

- **Branch de produção:** `main`, confirmada no painel pelo responsável. O projeto não tem conexão Git e não tem deploys. Ambiente do deploy: `production_branch === --branch` define Production; qualquer outra branch é Preview, com `env.preview` (sem D1, sem variáveis, sem o secret de produção).
- **`--config` não existe no `pages deploy`**: o Wrangler o recusa. A configuração vem do `wrangler.jsonc` do diretório atual, por isso o deploy sai do diretório isolado da seção 2b.
- **Bindings e variáveis** (`DELEGAS_DB`, `ADMIN_ORIGIN`) vão no metadado do deploy, lidos desse `wrangler.jsonc`. O projeto remoto não tem nenhum binding, variável ou secret de nível de projeto antes do primeiro deploy (confirmado por `pages download config`), então nada da homologação é herdado.
- **Deploy sem configuração Pages válida no diretório** remove os bindings do metadado. Cada novo deploy reenvia os bindings do `wrangler.jsonc` que estiver no diretório atual: um deploy feito do diretório errado troca o D1 sem aviso. O `preflight` existe para impedir isso.
- **Nome do projeto:** o Wrangler pode delegar um `pages deploy` de projeto **inexistente** (por exemplo, nome errado) a um deploy de Worker quando executado por um agente. O script fixa `--project-name chopp-delivery-prod` e confere que o projeto existe.
- **Identidade do D1 no runtime:** o arquivo local não prova o que roda. A prova é funcional: `/api/auth/me` 401 e, no passo 5, as contagens de `admin_login_limits` e `admin_sessions`.

## Falhas e recuperação

| Situação | Ação |
|---|---|
| `Assert-Prod` falha | Parar. Conferir `CLOUDFLARE_ACCOUNT_ID`, o login do Wrangler e o nome do D1. Nunca contornar o guarda. |
| `REFUSED_OR_UNCONFIRMED` | A etapa fixa indica a causa. Rodar o passo 3 (`inspect`). Com `owner: null`, corrigir a causa e repetir o passo 4 com configuração nova; com proprietário, seguir para o passo 5. Repetir é seguro: a inserção é singleton e atômica. |
| Resposta perdida após a escrita | Idem. A repetição devolve `NOT_APPLIED` sem alterar a conta. |
| Janela expirada | O Worker recusa. Gere nova configuração (novo `commandId` e `expiresAt`). |
| Pepper do Pages diferente do Worker (conta sem login) | Procedimento **separado e autorizado**, só se `SELECT count(*) FROM admin_sessions` for 0: redefinir os secrets para o mesmo pepper, remover a linha em `admin_users` por `d1 execute --remote` e repetir os passos 3 a 5. Escrita remota: exige autorização própria e export prévio. |
| Qualquer dúvida sobre o D1 apontado | Parar, desarmar (passo 6) e refazer o passo 1. |

## GO / NO-GO

**GO:** auditoria do código e do runbook; testes `production-bootstrap-*` e `production-account-guard` passando; D1, pepper e origem exclusivos de produção; guarda de conta passando; conta e `database_id` conferidos por duas pessoas; migrations `0001`–`0012` e zero administradores confirmados; export feito; `preflight` do deploy aprovado (`scripts/production-pages-deploy.mjs`); responsável presente.

**NO-GO:** qualquer recurso compartilhado com a homologação; guarda de conta falhando; migrations incompletas; id de D1 não conferido; pepper reutilizado; deploy fora do diretório isolado, com `--config` ou com branch diferente de `main`; `preflight` reprovado; custódia da senha indefinida; impossibilidade de acompanhar o Tail ou de desarmar.

## Riscos residuais

- Quem tiver acesso à conta Cloudflare durante a janela pode ler secrets e variáveis. Mantenha a janela curta (máx. 60 min) e remova os secrets ao final.
- O Worker não prova a identidade do operador nem que o D1 é o de produção; essa garantia vem do guarda e das conferências dos passos 1 e 6, que dependem de quem opera.
- O pepper do Worker e o do Pages vêm do mesmo `$Pepper`; só o login confirma. A diferença em relação à homologação é probabilística (256 bits aleatórios), não comparada.
- Os comandos remotos não foram executados: o comportamento do `wrangler tail` para eventos agendados, dos prompts de confirmação, do `pages secret put` num projeto ainda sem deploy e a precedência, no servidor, entre os bindings do deploy e os do projeto (hoje vazios) devem ser observados na primeira execução supervisionada.

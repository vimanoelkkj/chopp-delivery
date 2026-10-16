# L0A.2 — resultados locais e inventário para Antigravity

15/10/2026. Worktree `C:\Users\zZzZz\Projetos\chopp-delivery-integration`.
Branch `integration/delegas-f3`, HEAD `f062e7eaf8bfa8c15b5aa48b03e541b66bf1de0b`.
Preflight inicial: branch/HEAD exatos, staging vazio, árvore limpa. A execução
precisou de elevação do sandbox para escrever nesse worktree indicado pelo usuário,
que fica fora da raiz gravável inicial. Não houve recusa de aprovação automática.

## Gates

| Verificação | Resultado e escopo |
| --- | --- |
| Novos contratos/prova, primeiro conjunto | 68/68, três arquivos |
| Fronteira UTF-8 adicional | 1/1; exatamente 65.536 bytes aceitos, 65.537 recusados |
| Typecheck final | `npm.cmd run typecheck`: passou, frontend/backend |
| Biome final | `npm.cmd run lint`: 283 arquivos, zero erros/avisos |
| Vitest completo inicial | `npm.cmd test -- --maxWorkers=2`: 1.078/1.078, 64 arquivos, 139,86 s |
| Vitest completo após teste adicional | `npm.cmd test -- --maxWorkers=2`: 1.079/1.079, 65 arquivos, 139,65 s; exit 0 |
| Build normal | `npm.cmd run build`: passou; typecheck incluído |
| Artefato normal | `npm.cmd run verify:dist`: passou; 5 arquivos, 89 módulos, 129 literais verificados |
| Build release | `npm.cmd run build:release`: passou; typecheck e verificação incluídos |
| Artefato release explícito | `npm.cmd run verify:release`: passou; 5 arquivos, 137 módulos, 133 literais |
| npm audit | `npm.cmd audit --json`: zero vulnerabilidades em todos os níveis; 202 dependências no relatório |
| Whitespace | `git diff --check` e comparação de cada arquivo novo com arquivo vazio: sem erros |
| E2E | Não executados nesta etapa: nenhum import/consumidor em src/functions, endpoint, renderer ou configuração existente alterado |

O Vitest completo inclui os testes novos. Os 23 cenários internos da prova de mídia
fazem parte de um dos testes e não devem ser somados novamente à contagem Vitest.
Dois workers seguem a configuração operacional usada na L0A.1 para conter disputa
de recursos em Windows/workerd; nenhum timeout/asserção/configuração foi alterado.
Builds e audit não foram repetidos após a adição exclusiva de um arquivo de teste
e documentação; nenhum código de runtime ou dependência mudou entre esses gates.

Testes novos cobrem: documento válido, draft incompleto, publicação, tipos/tamanhos,
Unicode, invisíveis, HTML/URI, campos desconhecidos, preços proibidos no editorial,
fulfillment delivery, número canônico sem fallback, IDs/repetição/visibilidade,
âncoras/papéis/regiões/ordem, templates opcionais/listas, revisão/operação, projeção
sem dados administrativos e integridade do manifesto de mídia ready.
Testes de concorrência/idempotência são de formato do envelope: não provam replay
nem atomicidade D1 CMS. Esses experimentos dependem da futura implementação SQL.

## Evidência da prova

`node scripts/media-proof.mjs`: 23/23 cenários, scope
`LOCAL_NODE_AND_MINIFLARE_OFFLINE_ONLY`, remoteExecuted=false.
Execução registrada em TEMP: 1.042 ms, pico total do processo 203.892 KiB,
Node v26.7.0, sharp 0.35.5 e vips 8.18.7. Hero sintético: 1620×1080, 3.236 bytes,
SHA-256 `cfa25d992787ce25ef3be14b427fe037b7ef535a46b397477de4b75d86aeb44f`.
Isso confirma execução offline; não confirma decoder remoto, teto de memória de
isolate, qualidade visual para fotos reais ou SLA. Limitações, fontes oficiais,
matriz de formatos e experimento remoto: [cms-media-proof.md](cms-media-proof.md).

Logs fora do repositório, em `%TEMP%`:

- `delegas-l0a2-vitest.log` e `delegas-l0a2-vitest-final.log`.
- `delegas-l0a2-build.log` e `delegas-l0a2-release.log`.
- `delegas-l0a2-audit.json` e `delegas-l0a2-media.json`.

PowerShell pode encapsular notices npm de stderr como `NativeCommandError`; foram
considerados exit codes dos comandos e resumos dos runners, não esse rótulo isolado.
Na sessão restrita, Git avisou que não podia ler o ignore global do usuário; os
comandos de status/diff completaram e o `.gitignore` do projeto foi respeitado.

## Correções anteriores ao fechamento

- RED inicial do teste de contrato: import do módulo ainda inexistente.
- Fixture de animação consolidada por quadros idênticos: substituída por quadros
  distintos; mantida a asserção de dois quadros antes de testar rejeição.
- Binding offline devolveu largura 1620 para caixa 1920×1080 sobre origem 3:2;
  a expectativa exata foi corrigida conforme a proporção, sem afrouxar limites.
- Typecheck e Biome iniciais apontaram narrowing de telefone nullable, variável
  sem uso, export de fixture e formatação/tipagem de fixtures. Corrigidos, sem
  suppressions, mudança de configuração ou alteração de testes existentes.

## Arquivos novos (11); nenhum arquivo existente modificado

| Arquivo | Conteúdo |
| --- | --- |
| shared/cms.ts | Documento/envelopes/snapshots/projeção tipados e regras de composição |
| server/cms/validation.ts | Validadores puros de draft/publicação/operação e projeção pública |
| server/cms/media-contract.ts | Estados, limites, perfis e precondição pura de referências ready |
| scripts/media-proof.mjs | Laboratório Node + binding Images Miniflare offline |
| tests/backend/cms-contract.test.ts | 60 testes de contrato e entradas adversariais |
| tests/backend/cms-media-contract.test.ts | 7 testes de referências/manifestos/estados |
| tests/backend/cms-media-proof.test.ts | 1 teste que executa a prova autocontida de 23 cenários |
| tests/backend/cms-budget.test.ts | 1 teste de fronteira UTF-8 exata |
| docs/cms-contracts.md | Decisões, modelo D1/R2, concorrência/idempotência, publicação e recuperação |
| docs/cms-media-proof.md | Evidências/limitações locais, pesquisa, custos, isolamento e plano remoto |
| docs/l0a2-validation.md | Este relatório e estado final para auditoria |

## Git, riscos, pendências e recomendação

HEAD e branch preservados. Onze arquivos novos não rastreados; staging vazio;
nenhum arquivo rastreado alterado. Builds/caches/artefatos ignorados não integram a
entrega. Sem staging, commit, push, merge, deploy, migrations CMS ou operação remota
Cloudflare. Migrations F2/F3, catálogo, autenticação, layout, textos e lockfile intactos.

Orçamento hipotético: dentro das franquias e dos limites de CPU, uso pode ser zero;
Workers Paid tem mínimo publicado de US$5/mês, mais excedentes. Não se verificou o
plano/consumo da conta. Divergência publicada no storage D1 e cenários de custos
constam do documento de mídia. Riscos principais: diferenças codec local/remoto,
pressão de memória/CPU, revisões/recibos e GC ainda conceituais, retenção e custo.

Pendências: auditoria Antigravity, confirmação dos detalhes novos do contrato F4A,
WhatsApp/textos comerciais reais, retenção/carência/qualidade, estratégia de
processamento, recursos isolados e experimento remoto mediante autorização própria.

**GO condicionado para iniciar F4A.1 local após auditoria independente deste pacote.**
**NO-GO para upload/publicação/deploy em produção** até resolver a prova remota e os
controles transacionais/operacionais. Este fechamento não solicita commit; aguarda
a auditoria independente do Antigravity.

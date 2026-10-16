import { auditRelease } from './bundle-guard.mjs'

try {
  const result = await auditRelease({ root: process.cwd(), dir: process.argv[2] ?? 'dist-release' })
  if (result.problems.length) throw new Error(result.problems.join('\n'))
  console.log(
    `release limpo (${result.files} arquivos, ${result.modules} módulos, ${result.literals} literais verificados)`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na verificação do release')
  process.exitCode = 1
}

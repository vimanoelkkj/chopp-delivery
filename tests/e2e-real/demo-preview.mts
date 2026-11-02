import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sanitizeProcessEnv } from '../../scripts/clean-env.mts'
import { startIntegration } from '../../scripts/dev-admin-integration.mts'
import { previewFixture } from './preview-fixture.ts'

/** Explicit test/demo fixture. Always creates its own DB; never accepts a persistence path. */
async function main() {
  sanitizeProcessEnv([])
  const port = Number(process.argv[2] ?? 4186)
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Porta local inválida')
  let lab: Awaited<ReturnType<typeof startIntegration>> | undefined
  let stopping = false
  const stop = async () => {
    stopping = true
    await lab?.close()
    if (process.connected) process.disconnect?.()
  }
  process.on('message', (message) => {
    if (message === 'close') void stop()
  })
  process.on('disconnect', stop)
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    lab = await startIntegration({ port, mode: 'admin-integration' })
    if (stopping) {
      await lab.close()
      return
    }
    const origin = lab.origin
    if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Somente laboratório local')
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: lab.username, password: lab.password }),
    })
    if (!login.ok) throw new Error('Falha no login descartável')
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) throw new Error('Sessão descartável indisponível')
    const initialResponse = await fetch(`${origin}/api/admin/site`, { headers: { Cookie: cookie } })
    if (!initialResponse.ok) throw new Error('Falha na leitura do laboratório')
    const initial = (await initialResponse.json()) as {
      schema: null
      draft: { revision: string; document: null }
    }
    if (initial.schema !== null || initial.draft.document !== null)
      throw new Error('O laboratório não está vazio')
    const result = await fetch(`${origin}/api/admin/site/convert`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'application/json',
        'If-Match': `"${initial.draft.revision}"`,
      },
      body: JSON.stringify({
        action: 'startV2',
        expectedRevision: initial.draft.revision,
        operationId: crypto.randomUUID(),
        document: previewFixture(),
      }),
    })
    if (!result.ok) throw new Error('Falha ao preparar fixture editorial descartável')
    await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie },
    })
    process.send?.({
      origin,
      username: lab.username,
      password: lab.password,
      directory: lab.directory,
    })
    console.log(
      `Laboratório descartável com conteúdo sintético, sem publicação.\nLogin: ${origin}/admin\nPrévia: ${origin}/admin/preview\nUsuário: ${lab.username}\nSenha temporária: ${lab.password}\nCtrl+C remove exclusivamente este laboratório.`,
    )
  } catch (error) {
    await lab?.close()
    throw error
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Falha no laboratório')
    if (process.connected) {
      process.send?.({ error: 'Falha no laboratório descartável' })
      process.disconnect?.()
    }
    process.exitCode = 1
  })
}

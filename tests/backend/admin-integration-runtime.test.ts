import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readdir, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'

type Ready = {
  origin: string
  username: string
  password: string
  directory: string
  error?: string
}
function launch(port: number) {
  const child = fork('tests/e2e-real/server.mts', [], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    env: { ...process.env, DELEGAS_INTEGRATION_PORT: String(port) },
  })
  const exit = once(child, 'exit')
  const ready = Promise.race([
    once(child, 'message').then(([message]) => message as Ready),
    exit.then(() => {
      throw new Error('Server exited before reporting readiness')
    }),
  ])
  return { child, exit, ready }
}
const ownedDirectories = async () =>
  new Set((await readdir(tmpdir())).filter((name) => name.startsWith('delegas-admin-integration-')))

it('local runtime boots actual Pages Functions and disposes its owned D1 and listener', async () => {
  const f = launch(4187)
  let ready: Ready | undefined
  try {
    ready = await f.ready
    expect(ready.error).toBeUndefined()
    const catalog = await fetch(`${ready.origin}/api/catalog`)
    expect(catalog.status).toBe(200)
    expect(
      ((await catalog.json()) as { categories: { items: unknown[] }[] }).categories.map(
        (c) => c.items.length,
      ),
    ).toEqual([8, 1])
    const auth = await fetch(`${ready.origin}/api/auth/me`)
    expect(auth.status).toBe(401)
    await auth.text()
  } finally {
    if (f.child.connected) f.child.send('close')
    expect((await f.exit)[0]).toBe(0)
  }
  if (!ready) throw new Error('Missing runtime')
  await expect(stat(ready.directory)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fetch(ready.origin, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
}, 30_000)

it('startup port failure leaves no new owned database or runtime', async () => {
  const listener = createServer()
  await new Promise<void>((resolve) => listener.listen(4188, '127.0.0.1', resolve))
  const before = await ownedDirectories(),
    f = launch(4188)
  try {
    expect((await f.ready).error).toBeTruthy()
    expect((await f.exit)[0]).toBe(1)
    expect([...(await ownedDirectories())].filter((name) => !before.has(name))).toEqual([])
  } finally {
    if (f.child.connected) f.child.send('close')
    listener.close()
  }
}, 30_000)

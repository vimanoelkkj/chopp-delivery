import { startIntegration } from '../../scripts/dev-admin-integration.mts'

// A plain Node child avoids inheriting Playwright's loader into Miniflare's RPC threads.
let stopping = false
const pending = startIntegration({ port: Number(process.env.DELEGAS_INTEGRATION_PORT || 4185) })
async function stop() {
  if (stopping) return
  stopping = true
  const instance = await pending.catch(() => null)
  await instance?.close()
  if (process.connected) process.disconnect?.()
}
process.on('message', (message) => {
  if (message === 'close') void stop()
})
process.on('disconnect', () => void stop())
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
try {
  const instance = await pending
  if (stopping) await instance.close()
  else
    process.send?.({
      origin: instance.origin,
      username: instance.username,
      password: instance.password,
      directory: instance.directory,
    })
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : 'Local server failed' })
  if (process.connected) process.disconnect?.()
  process.exitCode = 1
}

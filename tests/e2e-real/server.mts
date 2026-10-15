import { sanitizeProcessEnv } from '../../scripts/clean-env.mts'
import { startIntegration } from '../../scripts/dev-admin-integration.mts'
import { integrationPort } from '../../scripts/integration-port.mts'

// Antes de qualquer outra coisa: filhos (Wrangler, Miniflare, workerd) herdam só o necessário.
sanitizeProcessEnv(['DELEGAS_INTEGRATION_MODE', 'DELEGAS_INTEGRATION_PORT', 'VITE_WHATSAPP_NUMBER'])

// A plain Node child avoids inheriting Playwright's loader into Miniflare's RPC threads.
let stopping = false
const mode = process.env.DELEGAS_INTEGRATION_MODE || 'admin-integration'
if (mode !== 'admin-integration' && mode !== 'production')
  throw new Error('Invalid local build mode')
const pending = startIntegration({
  port: integrationPort(),
  mode,
})
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
      envKeys: Object.keys(process.env).sort(), // diagnóstico do teste de higiene do ambiente
    })
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : 'Local server failed' })
  if (process.connected) process.disconnect?.()
  process.exitCode = 1
}

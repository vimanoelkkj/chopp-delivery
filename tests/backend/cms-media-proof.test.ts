import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('prova offline isolada: bytes, decoder, derivados e binding Images via service binding', () => {
  const result = spawnSync(process.execPath, ['scripts/media-proof.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 4500,
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  const evidence = JSON.parse(result.stdout)
  expect(evidence.scope).toBe('LOCAL_NODE_AND_MINIFLARE_OFFLINE_ONLY')
  expect(evidence.remoteExecuted).toBe(false)
  expect(evidence.checks).toBe(27)
  expect(evidence.hero.width).toBeLessThanOrEqual(1920)
  expect(evidence.hero.height).toBeLessThanOrEqual(1080)
})

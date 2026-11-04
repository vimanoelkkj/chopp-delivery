import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateCloudflarePlan } from './check-cloudflare-plan.mjs'

const plan = JSON.parse(
  await readFile(new URL('../config/cloudflare/environments.plan.json', import.meta.url), 'utf8'),
)
const checkUrl = new URL('./check-cloudflare-plan.mjs', import.meta.url)

test('preparatory plan is valid, but never indicates deployment readiness', () => {
  const result = validateCloudflarePlan(plan)
  assert.deepEqual(result.errors, [])
  assert.equal(result.ready, false)
  assert.ok(result.blockers.length > 0)
})

for (const [name, change] of [
  [
    'wrong dist artifact',
    (p) => {
      p.environments.homologation.pages.pages_build_output_dir = './dist'
    },
  ],
  [
    'automatic activation',
    (p) => {
      p.environments.homologation.enabled = true
    },
  ],
  [
    'fake D1 identifier',
    (p) => {
      p.environments.homologation.d1.database_id = 'replace-me'
    },
  ],
  [
    'public bucket',
    (p) => {
      p.environments.homologation.r2.publicAccess = true
    },
  ],
  [
    'premature processor binding',
    (p) => {
      p.environments.homologation.processor.remoteBindingEnabled = true
    },
  ],
  [
    'insecure local override',
    (p) => {
      p.environments.homologation.auth.ADMIN_ALLOW_INSECURE_LOCAL = '1'
    },
  ],
  [
    'embedded secret',
    (p) => {
      p.environments.homologation.auth.ADMIN_PASSWORD_PEPPER = 'not-a-secret'
    },
  ],
  [
    'publication enabled',
    (p) => {
      p.environments.homologation.editorial.publicationEnabled = true
    },
  ],
  [
    'public CMS consumption',
    (p) => {
      p.environments.homologation.editorial.publicCmsConsumptionEnabled = true
    },
  ],
  [
    'production activation',
    (p) => {
      p.environments.production.enabled = true
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const changed = structuredClone(plan)
    change(changed)
    assert.ok(validateCloudflarePlan(changed).errors.length > 0)
    assert.equal(validateCloudflarePlan(changed).ready, false)
  })
}

test('missing or malformed plan fails closed', () => {
  for (const malformed of [null, {}, [], { environments: null }])
    assert.ok(validateCloudflarePlan(malformed).errors.length > 0)
})

test('CLI separates valid preparation from blocked readiness and refuses deploy flags', () => {
  const run = (...args) =>
    spawnSync(process.execPath, [fileURLToPath(checkUrl), ...args], {
      encoding: 'utf8',
      windowsHide: true,
    })
  assert.equal(run().status, 0)
  assert.equal(run('--require-ready').status, 2)
  assert.equal(run('--deploy').status, 1)
})

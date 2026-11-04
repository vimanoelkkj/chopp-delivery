import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { pagesHomologationConfig } from './prepare-pages-homologation.mjs'

// Synthetic UUIDs exist only in memory; no deployable fixture/config is written.
const inventory = () => ({
  environment: 'homologation',
  acknowledgeDedicatedResources: true,
  projectName: 'homologation-fixture',
  origin: 'https://homologation-fixture.pages.dev',
  databaseName: 'homologation-fixture-db',
  databaseId: randomUUID(),
  production: {
    projectNames: ['production-fixture'],
    databaseIds: [randomUUID()],
    origins: ['https://production-fixture.pages.dev'],
  },
})
test('constructs a standalone release-only config without production bindings or secrets', () => {
  const input = inventory(),
    before = JSON.stringify(input),
    config = pagesHomologationConfig(input)
  assert.equal(config.name, input.projectName)
  assert.equal(config.pages_build_output_dir, './dist-release')
  assert.deepEqual(config.d1_databases, [
    {
      binding: 'DELEGAS_DB',
      database_name: input.databaseName,
      database_id: input.databaseId,
      migrations_dir: 'migrations',
    },
  ])
  assert.deepEqual(config.vars, { ADMIN_ORIGIN: input.origin })
  assert.deepEqual(config.r2_buckets, [])
  assert.deepEqual(config.services, [])
  assert.deepEqual(config.env.preview, { d1_databases: [], vars: {}, r2_buckets: [], services: [] })
  assert.equal(JSON.stringify(input), before)
  assert.ok(!JSON.stringify(config).includes(input.production.databaseIds[0]))
  const schema = JSON.parse(
    readFileSync(new URL('../node_modules/wrangler/config-schema.json', import.meta.url)),
  )
  for (const key of Object.keys(config).filter((key) => key !== '$schema'))
    assert.ok(key in schema.definitions.RawConfig.properties, key)
})
for (const [label, change] of [
  [
    'missing operator inventory',
    (i) => {
      delete i.databaseId
    },
  ],
  [
    'placeholder identifier',
    (i) => {
      i.databaseId = 'replace-me'
    },
  ],
  [
    'all-zero identifier',
    (i) => {
      i.databaseId = '00000000-0000-0000-0000-000000000000'
    },
  ],
  [
    'production database reuse',
    (i) => {
      i.databaseId = i.production.databaseIds[0]
    },
  ],
  [
    'production project reuse',
    (i) => {
      i.projectName = i.production.projectNames[0]
    },
  ],
  [
    'production origin reuse',
    (i) => {
      i.origin = i.production.origins[0]
    },
  ],
  [
    'HTTP origin',
    (i) => {
      i.origin = 'http://homologation-fixture.pages.dev'
    },
  ],
  [
    'reserved example origin',
    (i) => {
      i.origin = 'https://admin.example.com'
    },
  ],
  [
    'foreign Pages hostname',
    (i) => {
      i.origin = 'https://other-project.pages.dev'
    },
  ],
  [
    'unknown production inventory',
    (i) => {
      delete i.production
    },
  ],
  [
    'missing operator acknowledgement',
    (i) => {
      i.acknowledgeDedicatedResources = false
    },
  ],
  [
    'secret or extra config injection',
    (i) => {
      i.ADMIN_PASSWORD_PEPPER = 'not-a-secret'
    },
  ],
  [
    'insecure override',
    (i) => {
      i.ADMIN_ALLOW_INSECURE_LOCAL = '1'
    },
  ],
])
  test(`rejects ${label}`, () => {
    const input = inventory()
    change(input)
    assert.throws(() => pagesHomologationConfig(input))
  })
test('CLI with no operator parameters fails without creating a Wrangler file', () => {
  const target = new URL('../wrangler.homologation.jsonc', import.meta.url)
  const existed = existsSync(target)
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./prepare-pages-homologation.mjs', import.meta.url))],
    { encoding: 'utf8', windowsHide: true },
  )
  assert.equal(result.status, 1)
  assert.equal(existsSync(target), existed)
})

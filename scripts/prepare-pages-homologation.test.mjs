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
const mediaInventory = () => ({
  ...inventory(),
  projectName: 'chopp-delivery-homolog',
  origin: 'https://chopp-delivery-homolog.pages.dev',
  media: {
    bucketName: 'chopp-media-homolog-private',
    processorService: 'chopp-cms-image-processor-homologation',
    productionBucketNames: ['chopp-media-prod'],
    productionServices: ['chopp-cms-image-processor-prod'],
  },
})
test('media bindings are declared only for the canonical homologation, closed and not in preview', () => {
  const input = mediaInventory(),
    config = pagesHomologationConfig(input)
  assert.deepEqual(config.r2_buckets, [
    { binding: 'CMS_MEDIA_BUCKET', bucket_name: 'chopp-media-homolog-private' },
  ])
  assert.deepEqual(config.services, [
    { binding: 'CMS_MEDIA_PROCESSOR', service: 'chopp-cms-image-processor-homologation' },
  ])
  assert.equal(config.vars.CMS_MEDIA_ENABLED, 'disabled')
  assert.equal(config.vars.CMS_MEDIA_ENVIRONMENT, 'homologation')
  assert.equal(config.d1_databases[0].database_id, input.databaseId)
  assert.deepEqual(config.env.preview, { d1_databases: [], vars: {}, r2_buckets: [], services: [] })
  assert.ok(!JSON.stringify(config).includes('prod'))
})
test('without a media inventory no media binding or variable is produced', () => {
  const config = pagesHomologationConfig(inventory())
  assert.deepEqual(config.vars, { ADMIN_ORIGIN: 'https://homologation-fixture.pages.dev' })
})
for (const [label, change] of [
  [
    'non-canonical origin',
    (i) =>
      Object.assign(i, {
        projectName: 'homologation-fixture',
        origin: 'https://homologation-fixture.pages.dev',
      }),
  ],
  [
    'placeholder bucket',
    (i) => {
      i.media.bucketName = 'replace-me-bucket'
    },
  ],
  [
    'placeholder service',
    (i) => {
      i.media.processorService = 'placeholder-service'
    },
  ],
  [
    'production bucket reuse',
    (i) => {
      i.media.bucketName = i.media.productionBucketNames[0]
    },
  ],
  [
    'production service reuse',
    (i) => {
      i.media.processorService = i.media.productionServices[0]
    },
  ],
  [
    'service equal to Pages project',
    (i) => {
      i.media.processorService = i.projectName
    },
  ],
  [
    'missing production media inventory',
    (i) => {
      delete i.media.productionBucketNames
    },
  ],
  [
    'extra media key (enable flag)',
    (i) => {
      i.media.enabled = true
    },
  ],
]) {
  test(`media rejects ${label}`, () => {
    const input = mediaInventory()
    change(input)
    assert.throws(() => pagesHomologationConfig(input))
  })
}
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

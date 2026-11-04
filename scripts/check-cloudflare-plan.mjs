import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const planUrl = new URL('../config/cloudflare/environments.plan.json', import.meta.url)

// This is an offline plan validator, not a Wrangler config generator or deployment command.
export function validateCloudflarePlan(plan) {
  const errors = []
  const expect = (value, expected, field) => {
    if (!isDeepStrictEqual(value, expected)) errors.push(`Invalid ${field}`)
  }
  expect(
    Object.keys(plan ?? {}).sort(),
    ['environments', 'kind', 'pathBase', 'planVersion', 'remoteOperationsEnabled'],
    'plan fields',
  )
  expect(plan?.planVersion, 1, 'planVersion')
  expect(plan?.kind, 'offline-preparation-only', 'kind')
  expect(plan?.pathBase, 'repository-root', 'pathBase')
  expect(plan?.remoteOperationsEnabled, false, 'remote operations')
  const environments = plan?.environments
  expect(
    Object.keys(environments ?? {}).sort(),
    ['homologation', 'laboratory', 'production'],
    'environments',
  )
  expect(
    environments?.laboratory,
    {
      config: 'wrangler.jsonc',
      disposableHarness: 'scripts/dev-admin-integration.mts',
      remoteAllowed: false,
    },
    'laboratory',
  )
  const target = environments?.homologation
  expect(
    Object.keys(target ?? {}).sort(),
    ['auth', 'd1', 'editorial', 'enabled', 'pages', 'processor', 'r2'],
    'homologation fields',
  )
  expect(target?.enabled, false, 'homologation activation')
  expect(
    target?.pages,
    {
      projectName: null,
      pages_build_output_dir: './dist-release',
      buildCommand: 'npm run build:release',
      verifyCommand: 'npm run verify:release',
      compatibility_date: '2026-08-06',
    },
    'release artifact and pending Pages project',
  )
  expect(
    target?.d1,
    {
      binding: 'DELEGAS_DB',
      database_name: null,
      database_id: null,
      migrations_dir: 'migrations',
    },
    'pending isolated D1',
  )
  expect(
    target?.r2,
    {
      binding: 'CMS_MEDIA_BUCKET',
      bucket_name: null,
      publicAccess: false,
      remoteBindingEnabled: false,
    },
    'private pending R2',
  )
  expect(
    target?.processor,
    {
      binding: 'CMS_MEDIA_PROCESSOR',
      implementation: null,
      remoteBindingEnabled: false,
      profiles: ['hero', 'section'],
    },
    'unimplemented remote processor',
  )
  expect(
    target?.auth,
    {
      origin: null,
      requiredSecrets: ['ADMIN_PASSWORD_PEPPER'],
      forbiddenVars: ['ADMIN_ALLOW_INSECURE_LOCAL', 'CMS_MEDIA_LOCAL'],
      bootstrap: 'not-implemented-remotely',
      privateAccessPolicy: 'decision-required',
    },
    'pending secure authentication',
  )
  expect(
    target?.editorial,
    {
      publicationEnabled: false,
      publicCmsConsumptionEnabled: false,
    },
    'editorial isolation',
  )
  expect(
    environments?.production,
    {
      enabled: false,
      config: null,
      resources: null,
    },
    'production isolation',
  )
  return {
    errors,
    ready: false,
    blockers: [
      'No approved remote resources, HTTPS origin or private access policy.',
      'No remote owner bootstrap or credential recovery procedure.',
      'Media APIs require loopback; remote capability gate is not implemented.',
      'Images processor exists only in the local emulator; remote compatibility is unverified.',
      'No remote security, migration/recovery or artifact acceptance evidence.',
    ],
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--require-ready') || args.length > 1)
    throw new Error('Only --require-ready is supported; this command never deploys.')
  const plan = JSON.parse(await readFile(planUrl, 'utf8'))
  const result = validateCloudflarePlan(plan)
  if (result.errors.length) throw new Error(result.errors.join('\n'))
  console.log('Offline plan valid; remote execution remains BLOCKED.')
  for (const blocker of result.blockers) console.log(`- ${blocker}`)
  if (args.includes('--require-ready')) process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Invalid offline plan')
    process.exitCode = 1
  })
}

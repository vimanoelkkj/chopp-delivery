import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const output = new URL('../wrangler.homologation.jsonc', import.meta.url)
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const name = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/
const fail = () => {
  throw new Error('Invalid or incomplete dedicated homologation inventory')
}
function exactKeys(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    fail()
}
function list(value, predicate) {
  if (!Array.isArray(value) || !value.every(predicate) || new Set(value).size !== value.length)
    fail()
}
function validOrigin(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) &&
      !/(^|\.)(localhost|local|test|invalid|example)$/.test(url.hostname) &&
      !/(^|\.)example\.(com|net|org)$/.test(url.hostname)
    )
  } catch {
    return false
  }
}
const validId = (value) =>
  typeof value === 'string' && uuid.test(value) && new Set(value.replaceAll('-', '')).size > 1

/** Construct from explicit operator inventory only; never read the default Wrangler config. */
export function pagesHomologationConfig(input) {
  exactKeys(input, [
    'environment',
    'projectName',
    'origin',
    'databaseName',
    'databaseId',
    'production',
    'acknowledgeDedicatedResources',
  ])
  exactKeys(input.production, ['projectNames', 'databaseIds', 'origins'])
  if (
    input.environment !== 'homologation' ||
    input.acknowledgeDedicatedResources !== true ||
    typeof input.projectName !== 'string' ||
    !name.test(input.projectName) ||
    typeof input.databaseName !== 'string' ||
    !name.test(input.databaseName) ||
    !validId(input.databaseId) ||
    !validOrigin(input.origin)
  )
    fail()
  list(input.production.projectNames, (value) => typeof value === 'string' && name.test(value))
  list(input.production.databaseIds, validId)
  list(input.production.origins, validOrigin)
  if (
    input.production.projectNames.includes(input.projectName) ||
    input.production.databaseIds.includes(input.databaseId) ||
    input.production.origins.includes(input.origin)
  )
    fail()
  const host = new URL(input.origin).hostname
  if (host.endsWith('.pages.dev') && host !== `${input.projectName}.pages.dev`) fail()
  return {
    $schema: './node_modules/wrangler/config-schema.json',
    name: input.projectName,
    pages_build_output_dir: './dist-release',
    compatibility_date: '2026-08-06',
    d1_databases: [
      {
        binding: 'DELEGAS_DB',
        database_name: input.databaseName,
        database_id: input.databaseId,
        migrations_dir: 'migrations',
      },
    ],
    vars: { ADMIN_ORIGIN: input.origin },
    r2_buckets: [],
    services: [],
    env: { preview: { d1_databases: [], vars: {}, r2_buckets: [], services: [] } },
  }
}

async function main() {
  const { values } = parseArgs({
    options: { parameters: { type: 'string' } },
    allowPositionals: false,
  })
  if (!values.parameters) fail()
  const config = pagesHomologationConfig(JSON.parse(await readFile(values.parameters, 'utf8')))
  // Fixed root-level target keeps relative artifact/migrations/Functions paths unambiguous.
  // Never overwrite a reviewed file and never invoke Wrangler, migrations or a build.
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(
    `Local configuration generated: ${fileURLToPath(output)}; remote identity still requires verification.`,
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      'Configuration not generated: require a complete reviewed inventory and an unused output path.',
    )
    process.exitCode = 1
  })
}

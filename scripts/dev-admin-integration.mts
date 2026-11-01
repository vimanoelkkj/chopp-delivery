import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Miniflare } from 'miniflare'
import { build } from 'vite'
import { bootstrapOwner } from '../server/auth/bootstrap.ts'
import { childEnv, sanitizeProcessEnv } from './clean-env.mts'
import { integrationPort } from './integration-port.mts'
import { localImageWorker } from './local-image-worker.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js')

function command(args: string[]): Promise<void> {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      // Allowlist mínima: o Wrangler local não precisa de tokens da Cloudflare, AWS etc.
      env: childEnv({ WRANGLER_SEND_METRICS: 'false', CI: 'true' }),
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? accept() : reject(new Error(`Local Wrangler failed (${code})`)),
    )
  })
}

/** A fresh, owned database every time; no option accepts an operator's persistence path. */
export async function startIntegration({
  port = 4185,
  password = randomBytes(24).toString('hex'),
  mode = 'admin-integration',
  media = false,
}: {
  media?: boolean
  port?: number
  password?: string
  mode?: 'admin-integration' | 'production' | 'release'
} = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port')
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'delegas-admin-integration-')))
  const marker = randomUUID()
  await writeFile(join(directory, '.owner'), marker)
  const dist = join(directory, 'dist'),
    worker = join(directory, 'worker')
  const persist = join(directory, 'state'),
    databaseId = randomUUID()
  const origin = `http://127.0.0.1:${port}`
  const username = 'delegas-local',
    pepper = randomBytes(32).toString('hex')
  const config = join(directory, 'wrangler.json')
  let runtime: Miniflare | undefined
  let closed = false
  let startupFailure: unknown
  const close = async () => {
    if (closed) return
    closed = true
    // Dispose workerd before removing its owned SQLite/WAL directory.
    try {
      await runtime?.dispose()
    } catch (error) {
      // Miniflare rethrows its original readiness error after its finally block closes workerd.
      // Any different disposal failure retains the directory rather than deleting live state.
      if (error !== startupFailure) throw error
    }
    if ((await realpath(directory)) !== directory) throw new Error('Cleanup path changed')
    if ((await readFile(join(directory, '.owner'), 'utf8')) !== marker)
      throw new Error('Ownership marker changed; cleanup refused')
    await rm(directory, { recursive: true })
  }
  try {
    await writeFile(
      config,
      JSON.stringify({
        name: 'delegas-disposable-admin',
        compatibility_date: '2026-08-06',
        pages_build_output_dir: dist,
        d1_databases: [
          {
            binding: 'DELEGAS_DB',
            database_name: 'delegas-disposable-admin',
            database_id: databaseId,
            preview_database_id: databaseId,
            migrations_dir: resolve(root, 'migrations'),
          },
        ],
      }),
    )
    await build({
      root,
      envDir: false,
      mode,
      build: { outDir: dist, emptyOutDir: true },
    })
    await command([
      'pages',
      'functions',
      'build',
      join(root, 'functions'),
      '--outdir',
      worker,
      '--build-output-directory',
      dist,
      '--compatibility-date',
      '2026-08-06',
      '--compatibility-flags',
      'nodejs_compat',
    ])
    await command([
      'd1',
      'migrations',
      'apply',
      'DELEGAS_DB',
      '--local',
      '--config',
      config,
      '--persist-to',
      persist,
    ])
    const pages = {
      name: 'pages-local',
      modules: true,
      modulesRoot: worker,
      scriptPath: join(worker, 'index.js'),
      compatibilityDate: '2026-08-06',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DELEGAS_DB: databaseId },
      ...(media
        ? {
            r2Buckets: { CMS_MEDIA_BUCKET: randomUUID() },
            serviceBindings: { CMS_MEDIA_PROCESSOR: 'private-media-local' },
          }
        : {}),
      bindings: {
        ...(media ? { CMS_MEDIA_LOCAL: 'disposable-v1' } : {}),
        ADMIN_ORIGIN: origin,
        ADMIN_PASSWORD_PEPPER: pepper,
        ADMIN_ALLOW_INSECURE_LOCAL: '1',
      },
      assets: {
        directory: dist,
        binding: 'ASSETS',
        routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
        assetConfig: { not_found_handling: 'single-page-application' },
      },
    }
    runtime = new Miniflare({
      host: '127.0.0.1',
      port,
      r2Persist: false,
      d1Persist: join(persist, 'v3', 'd1'),
      workers: [
        pages,
        ...(media
          ? [
              {
                name: 'private-media-local',
                modules: true,
                compatibilityDate: '2026-08-06',
                images: { binding: 'IMAGES' },
                script: localImageWorker,
              },
            ]
          : []),
      ],
    })
    try {
      await runtime.ready
    } catch (error) {
      startupFailure = error
      throw error
    }
    const db = await runtime.getD1Database('DELEGAS_DB')
    if (!(await bootstrapOwner(db, username, password, pepper)))
      throw new Error('Disposable bootstrap refused')
    return { origin, username, password, db, directory, close }
  } catch (error) {
    await close()
    throw error
  }
}

async function main() {
  // Tudo que este processo criar (Wrangler, Miniflare/workerd, build) nasce sem credenciais herdadas.
  sanitizeProcessEnv(['DELEGAS_INTEGRATION_PORT', 'VITE_WHATSAPP_NUMBER', 'DELEGAS_MEDIA_LAB'])
  // Signals wait for finite build/migration commands, then dispose the one owned runtime.
  let stopping = false
  let instance: Awaited<ReturnType<typeof startIntegration>> | undefined
  const stop = async () => {
    stopping = true
    if (instance) await instance.close()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    instance = await startIntegration({
      port: integrationPort(),
      media: process.env.DELEGAS_MEDIA_LAB === '1',
    })
    if (stopping) {
      await instance.close()
      return
    }
    console.log(
      `\nDisposable REAL admin: ${instance.origin}/admin\nUser: ${instance.username}\nTemporary password: ${instance.password}\nCtrl+C disposes this database. No remote D1 is used.`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Local integration failed')
    process.exitCode = 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()

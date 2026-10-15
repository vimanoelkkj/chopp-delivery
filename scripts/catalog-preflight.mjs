import { lstat, open, readFile, realpath, stat } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { extname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// Existing application TS imports omit extensions; scope resolution to this import graph.
async function loadPreflight() {
  const root = new URL('../', import.meta.url).href
  const hook = registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context)
      } catch (error) {
        if (
          error.code === 'ERR_MODULE_NOT_FOUND' &&
          specifier.startsWith('.') &&
          !extname(specifier) &&
          context.parentURL?.startsWith(root) &&
          context.parentURL.endsWith('.ts')
        )
          return next(`${specifier}.ts`, context)
        throw error
      }
    },
  })
  try {
    return await import('../server/catalog-expansion/preflight.ts')
  } finally {
    hook.deregister()
  }
}

// Escape terminal controls and invisible/non-ASCII IDs without changing their JSON values.
const output = (report) =>
  process.stdout.write(
    `${JSON.stringify(report, null, 2).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`,
  )
async function main() {
  const { values } = parseArgs({
    options: { sqlite: { type: 'string' }, help: { type: 'boolean' } },
    allowPositionals: false,
  })
  if (values.help) {
    console.log('Uso: npm run catalog:preflight -- --sqlite <copia-local-consistente.sqlite>')
    return
  }
  if (!values.sqlite || values.sqlite.includes('://') || values.sqlite === ':memory:')
    throw new Error('Explicit local file required')
  const { catalogPreflight } = await loadPreflight()
  const migration = await readFile(
    new URL('../migrations/0005_catalog_expansion.sql', import.meta.url),
    'utf8',
  )
  const file = await realpath(resolve(values.sqlite))
  const before = await stat(file, { bigint: true })
  if (!before.isFile()) throw new Error('UNSAFE_SNAPSHOT')
  const source = await open(file, 'r')
  const header = Buffer.alloc(100)
  try {
    await source.read(header, 0, header.length, 0)
  } finally {
    await source.close()
  }
  // Immutable must never hide a pending WAL/journal or be used on a live database.
  if (
    header.toString('ascii', 0, 16) !== 'SQLite format 3\0' ||
    header[18] !== 1 ||
    header[19] !== 1
  )
    throw new Error('UNSAFE_SNAPSHOT')
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      await lstat(`${file}${suffix}`)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    throw new Error('UNSAFE_SNAPSHOT')
  }
  const uri = pathToFileURL(file)
  uri.search = 'mode=ro&immutable=1'
  const db = new DatabaseSync(uri.href, { readOnly: true, allowExtension: false })
  let report
  try {
    db.exec('PRAGMA query_only=ON; BEGIN')
    report = await catalogPreflight(async (sql) => {
      // D1 supports quick_check; native SQLite can also verify UNIQUE/index consistency.
      const statement = db.prepare(sql === 'PRAGMA quick_check' ? 'PRAGMA integrity_check' : sql)
      statement.setReadBigInts(true)
      return statement
        .all()
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              typeof value === 'bigint' &&
              value >= BigInt(Number.MIN_SAFE_INTEGER) &&
              value <= BigInt(Number.MAX_SAFE_INTEGER)
                ? Number(value)
                : value,
            ]),
          ),
        )
    }, migration)
  } finally {
    try {
      if (db.isTransaction) db.exec('ROLLBACK')
    } finally {
      db.close()
    }
  }
  const after = await stat(file, { bigint: true })
  if (['size', 'mtimeNs', 'ctimeNs', 'ino', 'dev'].some((key) => before[key] !== after[key]))
    throw new Error('UNSAFE_SNAPSHOT')
  output(report)
  process.exitCode = report.ok ? 0 : 1
}
main().catch((error) => {
  const unsafe = error.message === 'UNSAFE_SNAPSHOT'
  output({
    ok: false,
    blockers: [
      {
        code: unsafe ? 'UNSAFE_SNAPSHOT' : 'PREFLIGHT_UNAVAILABLE',
        table: 'database',
        message: unsafe
          ? 'Snapshot não autônomo, inválido ou alterado durante a leitura. Exige backup consistente em modo rollback (DELETE), sem WAL/SHM/journal. Não apague auxiliares: prepare outro backup. Nenhum dado foi corrigido.'
          : 'Preflight indisponível. Use --sqlite com uma cópia local consistente e legível. Flags remotas e argumentos desconhecidos são recusados. Nenhum dado foi corrigido.',
      },
    ],
  })
  process.exitCode = 2
})

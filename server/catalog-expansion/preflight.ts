import { validCents, validText } from '../admin-catalog/validation'
import { EXPANSION_LIMITS, validateExpanded, validId, validVolume } from './validation'

type Row = Record<string, unknown>
export type PreflightIssue = {
  code: string
  table: string
  recordId?: string | null
  row?: number
  field?: string
  message: string
  codePoints?: string[]
}
const sourceColumns: Record<string, string[]> = {
  products: [
    'id',
    'name',
    'description',
    'price_30_cents',
    'price_50_cents',
    'visible',
    'sort_order',
  ],
  cachaca: ['id', 'title', 'description', 'bottle_ml', 'price_cents', 'visible', 'singleton'],
  catalog_meta: ['singleton', 'revision'],
  d1_migrations: ['id', 'name', 'applied_at'],
}
const history = [
  '0001_catalog.sql',
  '0002_catalog_seed.sql',
  '0003_admin_auth.sql',
  '0004_catalog_revision.sql',
]

/** The caller supplies a consistent snapshot. Only SELECT and read-only PRAGMA are issued. */
export async function catalogPreflight(read: (sql: string) => Promise<Row[]>, migration: string) {
  const blockers: PreflightIssue[] = []
  const issue = (
    code: string,
    table: string,
    message: string,
    extra: Partial<PreflightIssue> = {},
  ) => {
    blockers.push({ code, table, message, ...extra })
  }
  const query = async (sql: string, table: string) => {
    try {
      return await read(sql)
    } catch {
      issue('READ_FAILED', table, 'Não foi possível ler esta parte do snapshot.')
      return []
    }
  }
  const schema = await query(
    'SELECT type,name,tbl_name FROM sqlite_schema ORDER BY type,name',
    'sqlite_schema',
  )
  const created = [
    ...migration.matchAll(/^CREATE (?:UNIQUE )?(TABLE|VIEW|INDEX|TRIGGER) (\w+)/gm),
  ].map((m) => m[2])
  const dropped = [...migration.matchAll(/^DROP (TABLE|VIEW|INDEX|TRIGGER) (\w+)/gm)].filter(
    (m) => !created.includes(m[2]),
  )
  if (
    !created.includes('catalog_write_command') ||
    !dropped.some((m) => m[2] === 'catalog_save_command')
  )
    issue(
      'MIGRATION_CONTRACT',
      'sqlite_schema',
      'Arquivo 0005 não corresponde ao contrato esperado.',
    )
  for (const name of created)
    if (schema.some((o) => o.name === name))
      issue(
        'TARGET_OBJECT_EXISTS',
        'sqlite_schema',
        `Objeto de destino já existe: ${name}. Schema parcial/aplicado não pode ser remigrado.`,
      )
  for (const [, type, name] of dropped)
    if (!schema.some((o) => o.name === name && o.type === type.toLowerCase()))
      issue(
        'SOURCE_OBJECT_MISSING',
        'sqlite_schema',
        `Objeto necessário ao corte ausente: ${name} (${type}).`,
      )
  for (const o of schema)
    if (
      o.type === 'trigger' &&
      ['products', 'cachaca', 'catalog_meta', 'catalog_save'].includes(o.tbl_name as string) &&
      !dropped.some((m) => m[2] === o.name)
    )
      issue(
        'UNEXPECTED_TRIGGER',
        o.tbl_name as string,
        `Trigger fora do contrato de origem: ${o.name}. Exige revisão manual.`,
      )
  const rows: Record<string, Row[]> = {}
  for (const [table, expected] of Object.entries(sourceColumns)) {
    if (!schema.some((o) => o.name === table && o.type === 'table')) {
      issue('SOURCE_TABLE_MISSING', table, 'Tabela de origem ausente.')
      rows[table] = []
      continue
    }
    const columns = await query(`PRAGMA table_info('${table}')`, table)
    for (const field of expected)
      if (!columns.some((c) => c.name === field))
        issue('SOURCE_COLUMN_MISSING', table, 'Coluna obrigatória ausente.', { field })
    for (const c of columns)
      if (!expected.includes(c.name as string))
        issue('UNEXPECTED_SOURCE_COLUMN', table, 'Coluna não prevista: a 0005 não a preservaria.', {
          field: c.name as string,
        })
    // Table names come exclusively from sourceColumns, never from database content.
    const texts = (
      table === 'products'
        ? ['id', 'name', 'description']
        : table === 'cachaca'
          ? ['id', 'title', 'description']
          : []
    ).filter((field) => columns.some((c) => c.name === field))
    const encodings = texts
      .map((field) => `,hex(CAST(${field} AS BLOB)) AS __preflight_${field}`)
      .join('')
    rows[table] = await query(
      `SELECT *${encodings} FROM ${table} ORDER BY ${table === 'catalog_meta' ? 'singleton' : table === 'd1_migrations' ? 'name' : 'id'}`,
      table,
    )
  }
  const integrity = await query('PRAGMA quick_check', 'database')
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok')
    issue(
      'INTEGRITY_CHECK',
      'database',
      'A verificação de integridade SQLite não aprovou o arquivo.',
    )
  const foreignKeys = await query('PRAGMA foreign_key_check', 'database')
  for (const fk of foreignKeys)
    issue(
      'FOREIGN_KEY',
      String(fk.table),
      `Referência inválida para ${String(fk.parent)}, rowid ${String(fk.rowid)}.`,
    )
  // Compile the post-cut authorization dependency without reading credential/session rows.
  await query(
    'SELECT u.id FROM admin_users u JOIN admin_sessions s ON s.user_id=u.id WHERE 0 AND u.active=1 AND s.auth_version=u.auth_version AND s.token_hash IS NOT NULL AND s.origin IS NOT NULL AND s.expires_at>0',
    'admin_users/admin_sessions',
  )
  for (const name of history)
    if (rows.d1_migrations.filter((r) => r.name === name).length !== 1)
      issue('MIGRATION_HISTORY', 'd1_migrations', `Exige exatamente uma aplicação de ${name}.`)
  for (const r of rows.d1_migrations)
    if (!history.includes(r.name as string))
      issue(
        'UNEXPECTED_MIGRATION',
        'd1_migrations',
        `Preflight exige origem 0004; histórico contém ${String(r.name)}.`,
      )
  const meta = rows.catalog_meta
  if (
    meta.length !== 1 ||
    meta[0].singleton !== 1 ||
    !Number.isSafeInteger(meta[0].revision) ||
    Number(meta[0].revision) < 0 ||
    Number(meta[0].revision) >= Number.MAX_SAFE_INTEGER
  )
    issue(
      'REVISION_UNAVAILABLE',
      'catalog_meta',
      'Exige singleton 1 e revisão inteira segura com espaço para o avanço do corte.',
    )
  const ids = new Set<string>()
  for (const table of ['products', 'cachaca'])
    for (const [index, r] of rows[table].entries()) {
      const record = { recordId: typeof r.id === 'string' ? r.id : null, row: index + 1 }
      const fail = (
        code: string,
        field: string,
        message: string,
        details: Partial<PreflightIssue> = {},
      ) => issue(code, table, message, { ...record, field, ...details })
      for (const field of ['id', table === 'products' ? 'name' : 'title', 'description'])
        if (typeof r[field] === 'string') {
          const encoded = [...new TextEncoder().encode(r[field] as string)]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase()
          if (r[`__preflight_${field}`] !== encoded)
            fail(
              'INVALID_UTF8',
              field,
              'Bytes TEXT incompatíveis com UTF-8 válido; nenhuma substituição automática é aceita.',
            )
        }
      if (!validId(r.id))
        fail(
          'INVALID_ID',
          'id',
          'Use ID string de 1–128 unidades UTF-16, sem controles ou Unicode inseguro.',
        )
      if (typeof r.id === 'string') {
        if (ids.has(r.id))
          fail('ID_COLLISION', 'id', 'ID repetido no catálogo unificado, inclusive entre tabelas.')
        ids.add(r.id)
      }
      for (const field of [table === 'products' ? 'name' : 'title', 'description'])
        if (!validText(r[field], field !== 'description')) {
          const text = r[field]
          fail(
            'INVALID_TEXT',
            field,
            field === 'description'
              ? 'Descrição inválida: até 2000 caracteres, sem Unicode inseguro ou controles proibidos.'
              : 'Nome exige caractere visível, até 120 caracteres, sem controles/bidi ou Unicode inválido.',
            typeof text === 'string'
              ? {
                  codePoints: [...text]
                    .slice(0, 16)
                    .map(
                      (c) => `U+${c.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`,
                    ),
                }
              : {},
          )
        }
      if (r.visible !== 0 && r.visible !== 1)
        fail('INVALID_VISIBILITY', 'visible', 'Use inteiro 0 ou 1.')
      const fields = table === 'products' ? ['price_30_cents', 'price_50_cents'] : ['price_cents']
      for (const field of fields)
        if (!(table === 'products' && r[field] === null) && !validCents(r[field]))
          fail(
            'INVALID_CENTS',
            field,
            'Use centavos inteiros entre 1 e 9999999; null somente para tamanho de chope não comercializado.',
          )
      if (table === 'products') {
        if (
          !Number.isInteger(r.sort_order) ||
          Number(r.sort_order) < 0 ||
          Number(r.sort_order) > 2147483647
        )
          fail('INVALID_ORDER', 'sort_order', 'Use inteiro entre 0 e 2147483647.')
        if (r.visible === 1 && !fields.some((field) => validCents(r[field])))
          fail(
            'VISIBLE_WITHOUT_PRICE',
            'visible',
            'Item visível exige ao menos uma variante com preço válido.',
          )
      } else {
        if (!validVolume(r.bottle_ml))
          fail('INVALID_VOLUME', 'bottle_ml', 'Volume deve ser inteiro positivo seguro.')
        if (r.singleton !== 1)
          fail('INVALID_SINGLETON', 'singleton', 'Registro legado exige singleton 1.')
      }
    }
  const products = rows.products,
    cachacas = rows.cachaca
  const counts = {
    products: products.length,
    cachacas: cachacas.length,
    variants: products.length * 2 + cachacas.length,
  }
  if (
    products.length + cachacas.length > EXPANSION_LIMITS.items ||
    counts.variants > EXPANSION_LIMITS.variants
  )
    issue('WRITE_COUNT_LIMIT', 'catalog', 'Catálogo excederia os limites do PUT v2 completo.')
  // Validate the complete projected DTO too; new v2 rules must also block this tool.
  if (!blockers.length) {
    const dto = {
      revision: 'r0',
      categories: [
        {
          id: 'chopes',
          name: 'Chopes',
          items: products.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            visible: r.visible === 1,
            variants: [
              {
                code: '30',
                label: 'Barril de 30 L',
                volumeMl: 30000,
                priceCents: r.price_30_cents,
              },
              {
                code: '50',
                label: 'Barril de 50 L',
                volumeMl: 50000,
                priceCents: r.price_50_cents,
              },
            ],
          })),
        },
        {
          id: 'cachacas',
          name: 'Cachaças',
          items: cachacas.map((r) => ({
            id: r.id,
            name: r.title,
            description: r.description,
            visible: r.visible === 1,
            variants: [
              {
                code: 'bottle',
                label: 'Garrafa',
                volumeMl: r.bottle_ml,
                priceCents: r.price_cents,
              },
            ],
          })),
        },
      ],
    }
    const parsed = validateExpanded(dto, 'r0')
    if (parsed.fields)
      for (const [field, message] of Object.entries(parsed.fields))
        issue('V2_CONTRACT', 'catalog', message, { field })
    // Use the actual post-cut revision length, never a guessed increment on the client.
    dto.revision = `r${Number(meta[0].revision) + 1}`
    if (new TextEncoder().encode(JSON.stringify(dto)).length > EXPANSION_LIMITS.bytes)
      issue('WRITE_BODY_LIMIT', 'catalog', 'Snapshot completo excederia 128 KiB UTF-8 no PUT v2.')
  }
  return { ok: blockers.length === 0, migration: '0005_catalog_expansion.sql', counts, blockers }
}

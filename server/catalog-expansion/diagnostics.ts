/**
 * Etiqueta curta e segura para falhas inesperadas de SQL/D1 (ex.: `SQLITE_ERROR code=7500 NESTED_TOO_DEEP`).
 * Nunca devolve a mensagem original: o texto do D1 pode conter a consulta e os parâmetros (payload do
 * catálogo, tokens). Só saem fragmentos que casam com padrões fechados abaixo, com tamanho limitado.
 */
const APP_CODE = /\bCATALOG_[A-Z_]{1,40}\b/
const SQLITE_CODE = /\bSQLITE_[A-Z_]{1,40}\b/
// D1 anexa "[code: 7500]" ao erro do SQLite; o rótulo "code" é fixo e o valor, numérico.
const NUMERIC_CODE = /\[code:\s*(\d{3,5})\]/
const KNOWN_PHRASES: readonly (readonly [RegExp, string])[] = [
  [/nested too deep/i, 'NESTED_TOO_DEEP'],
  [/too many (?:sql )?variables/i, 'TOO_MANY_VARIABLES'],
  [/(?:statement|string|blob) too big|too large/i, 'TOO_BIG'],
  [/constraint/i, 'CONSTRAINT'],
  [/timed? ?out|timeout/i, 'TIMEOUT'],
]

export function sqlFailureTag(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const parts = [
    APP_CODE.exec(message)?.[0],
    SQLITE_CODE.exec(message)?.[0],
    NUMERIC_CODE.exec(message) ? `code=${NUMERIC_CODE.exec(message)?.[1]}` : undefined,
    ...KNOWN_PHRASES.filter(([pattern]) => pattern.test(message)).map(([, tag]) => tag),
  ].filter((part): part is string => part !== undefined)
  return parts.length ? [...new Set(parts)].join(' ') : 'UNKNOWN'
}

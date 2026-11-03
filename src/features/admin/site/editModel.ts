import { CMS_LIMITS } from '../../../../shared/cms/common'
import { text as contractText } from '../../../../shared/cms/primitives'
import type { CmsDocumentV2, CmsModuleV2 } from '../../../../shared/cms/v2'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'

/**
 * Edição textual do rascunho (E6.1): modelo puro, sem rede e sem DOM.
 *
 * O documento editado é uma cópia local. Só os campos que o contrato aceita como texto editorial
 * mudam; ids, tipos, ordem, navegação, referências de catálogo, mídia e dados comerciais passam
 * intactos. A validação final é sempre a do contrato (`parseCmsDocument`), nunca uma regra paralela:
 * as mensagens abaixo só explicam, em português, por que o validador do contrato recusaria o texto.
 */

export type FieldKind = 'heading' | 'text'

const LIMIT: Record<FieldKind, number> = { heading: CMS_LIMITS.heading, text: CMS_LIMITS.text }

/** Quantos caracteres o contrato conta (pontos de código, como o validador). */
export const countChars = (value: string) => [...value].length

/** Campos de linha única usam o limite de título; os demais, o de texto. */
export const kindOf = (key: string): FieldKind =>
  key === 'heading' ||
  (key.startsWith('items.') && !key.endsWith('.answer')) ||
  key.endsWith('.title') ||
  key.endsWith('.question')
    ? 'heading'
    : 'text'

export const limitOf = (kind: FieldKind) => LIMIT[kind]

const LINK =
  /\b(?:https?|ftp|sftp|javascript|vbscript|data|file|blob|mailto|tel|sms|wss?):|[a-z][a-z0-9+.-]*:\s*\/\/|\/\/|www\./iu

/** Por que o contrato recusaria este texto; `null` quando ele é aceito. */
export function fieldProblem(value: string, kind: FieldKind): string | null {
  const multiline = kind === 'text'
  if (contractText(value, LIMIT[kind], false, multiline)) return null
  const extra = countChars(value) - LIMIT[kind]
  if (extra > 0)
    return `${extra === 1 ? 'Sobra 1 caractere' : `Sobram ${extra} caracteres`}: o limite é ${LIMIT[kind]}.`
  if (/[<>]/.test(value)) return 'Não use os símbolos < e >.'
  if (LINK.test(value.replace(/[\p{Default_Ignorable_Code_Point}\t\r\n]/gu, '')))
    return 'Não coloque endereços de site ou links neste campo.'
  if (!multiline && /[\r\n\p{Zl}\p{Zp}]/u.test(value)) return 'Use uma linha só neste campo.'
  return 'Este texto tem caracteres que o site não aceita. Remova símbolos invisíveis ou de controle.'
}

type Located = { module: CmsModuleV2; index: number }

const locate = (doc: CmsDocumentV2, id: string): Located | null => {
  const index = doc.modules.findIndex((m) => m.id === id)
  return index < 0 ? null : { module: doc.modules[index], index }
}

const replaceModule = (doc: CmsDocumentV2, index: number, module: CmsModuleV2): CmsDocumentV2 => ({
  ...doc,
  modules: doc.modules.map((m, i) => (i === index ? module : m)),
})

type Bag = Record<string, unknown>
const asBag = (value: unknown): Bag => value as Bag

/** Valor de texto do campo `key` (`heading`, `items.2`, `steps.0.title`…) ou `null` se não for um texto editável. */
const editableKey = (module: CmsModuleV2, key: string): boolean => {
  const fields: Record<CmsModuleV2['template'], readonly string[]> = {
    hero: ['heading', 'summary'],
    carousel: ['heading', 'lead'],
    catalog: ['heading', 'intro'],
    ticker: [],
    how: ['heading'],
    about: ['heading', 'body'],
    highlight: ['heading', 'body'],
    faq: ['heading'],
    contact: ['heading', 'body'],
  }
  if (fields[module.template].includes(key)) return true
  if (module.template === 'ticker') return /^items\.(0|[1-9]\d*)$/.test(key)
  if (module.template === 'how') return /^steps\.(0|[1-9]\d*)\.(title|body)$/.test(key)
  return module.template === 'faq' && /^items\.(0|[1-9]\d*)\.(question|answer)$/.test(key)
}

export function readField(module: CmsModuleV2, key: string): string | null {
  if (!editableKey(module, key)) return null
  const parts = key.split('.')
  let cursor: unknown = module.content
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return null
    cursor = (cursor as Bag)[part]
  }
  return typeof cursor === 'string' ? cursor : null
}

const clone = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(clone)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
      : value

/** Troca um texto editorial. Recusa qualquer caminho que não seja um texto já existente. */
export function setField(
  doc: CmsDocumentV2,
  moduleId: string,
  key: string,
  value: string,
): CmsDocumentV2 {
  const found = locate(doc, moduleId)
  if (!found || readField(found.module, key) === null) return doc
  const content = clone(found.module.content) as Bag
  const parts = key.split('.')
  let cursor: Bag = content
  for (const part of parts.slice(0, -1)) cursor = asBag(cursor[part])
  cursor[parts[parts.length - 1]] = value
  return replaceModule(doc, found.index, { ...found.module, content } as CmsModuleV2)
}

export const MANDATORY_TEMPLATES = ['hero', 'catalog', 'contact'] as const
export const isMandatory = (module: CmsModuleV2) =>
  (MANDATORY_TEMPLATES as readonly string[]).includes(module.template)

/** Mostra ou oculta uma seção opcional. Seções obrigatórias nunca mudam. */
export function setVisible(doc: CmsDocumentV2, moduleId: string, visible: boolean): CmsDocumentV2 {
  const found = locate(doc, moduleId)
  if (!found || isMandatory(found.module) || found.module.visible === visible) return doc
  return replaceModule(doc, found.index, { ...found.module, visible } as CmsModuleV2)
}

export type ListName = 'items' | 'steps'

const blankItem = (template: string, list: ListName): unknown =>
  list === 'steps'
    ? { title: '', body: '' }
    : template === 'faq'
      ? { question: '', answer: '' }
      : ''

/** Qual lista editorial a seção tem (a faixa e o FAQ usam `items`; "Como funciona" usa `steps`). */
export function listOf(module: CmsModuleV2): ListName | null {
  if (module.template === 'how') return 'steps'
  if (module.template === 'ticker' || module.template === 'faq') return 'items'
  return null
}

export const listLength = (module: CmsModuleV2): number => {
  const list = listOf(module)
  return list ? (asBag(module.content)[list] as unknown[]).length : 0
}

/** Acrescenta um item em branco ao fim da lista, respeitando o limite do contrato. */
export function addItem(doc: CmsDocumentV2, moduleId: string): CmsDocumentV2 {
  const found = locate(doc, moduleId)
  const list = found && listOf(found.module)
  if (!found || !list || listLength(found.module) >= CMS_LIMITS.list) return doc
  const content = clone(found.module.content) as Bag
  ;(content[list] as unknown[]).push(blankItem(found.module.template, list))
  return replaceModule(doc, found.index, { ...found.module, content } as CmsModuleV2)
}

/** Remove o item `index` da lista da seção. */
export function removeItem(doc: CmsDocumentV2, moduleId: string, index: number): CmsDocumentV2 {
  const found = locate(doc, moduleId)
  const list = found && listOf(found.module)
  if (!found || !list || index < 0 || index >= listLength(found.module)) return doc
  const content = clone(found.module.content) as Bag
  ;(content[list] as unknown[]).splice(index, 1)
  return replaceModule(doc, found.index, { ...found.module, content } as CmsModuleV2)
}

/** Há diferença entre o documento salvo e o editado? (Comparação estrutural, na ordem do documento.) */
export const isDirty = (saved: CmsDocumentV2, edited: CmsDocumentV2) =>
  JSON.stringify(saved) !== JSON.stringify(edited)

/** Chave de um campo para erros e foco: `<id da seção>|<caminho>`. */
export const problemKey = (moduleId: string, key: string) => `${moduleId}|${key}`

export type EditCheck = {
  /** Problemas por campo (`problemKey`). */
  problems: Map<string, string>
  /** Quantas seções têm algum problema (para avisar em seções não selecionadas). */
  sections: Set<string>
  /** O contrato recusa o documento por um motivo que não é de um campo (ex.: tamanho total). */
  documentProblem: string | null
}

/** Todos os textos do documento, com a mesma regra do contrato, mais a validação do documento inteiro. */
export function checkDocument(doc: CmsDocumentV2): EditCheck {
  const problems = new Map<string, string>()
  const sections = new Set<string>()
  const visit = (module: CmsModuleV2, key: string, value: string) => {
    const problem = fieldProblem(value, kindOf(key))
    if (!problem) return
    problems.set(problemKey(module.id, key), problem)
    sections.add(module.id)
  }
  for (const module of doc.modules) {
    const content = asBag(module.content)
    for (const [name, value] of Object.entries(content)) {
      if (typeof value === 'string') visit(module, name, value)
      else if (Array.isArray(value))
        value.forEach((item, index) => {
          if (typeof item === 'string') visit(module, `${name}.${index}`, item)
          else if (item !== null && typeof item === 'object')
            for (const [part, inner] of Object.entries(item))
              if (typeof inner === 'string') visit(module, `${name}.${index}.${part}`, inner)
        })
    }
  }
  const parsed = parseCmsDocument(doc, 'draft')
  const documentProblem =
    problems.size === 0 && !parsed.value
      ? 'O documento inteiro passou das regras do site (por exemplo, o tamanho total). Reduza algum texto.'
      : null
  return { problems, sections, documentProblem }
}

export const canSave = (check: EditCheck) => check.problems.size === 0 && !check.documentProblem

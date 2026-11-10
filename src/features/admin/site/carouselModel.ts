import { CMS_ITEM_ID_PATTERN, CMS_LIMITS } from '../../../../shared/cms'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import type { AdminCatalog } from '../catalog/types'

/** Only persisted, visible chopes. Commercial data never enters the editorial document. */
export function eligibleBarrels(catalog: AdminCatalog) {
  return catalog.categories
    .filter((category) => category.id === 'chopes')
    .flatMap((category) => category.items)
    .filter((item) => item.visible && CMS_ITEM_ID_PATTERN.test(item.id))
    .map(({ id, name }) => ({ id, name }))
}

export function changeCarousel(
  doc: CmsDocumentV2,
  moduleId: string,
  action:
    | { kind: 'add'; itemId: string; catalog: AdminCatalog }
    | { kind: 'remove'; itemId: string }
    | { kind: 'move'; itemId: string; direction: -1 | 1 },
): CmsDocumentV2 {
  const module = doc.modules.find((entry) => entry.id === moduleId)
  if (module?.template !== 'carousel') return doc
  const entries = [...module.content.entries]
  const index = entries.findIndex((entry) => entry.itemId === action.itemId)
  if (action.kind === 'add') {
    if (
      index !== -1 ||
      entries.length >= CMS_LIMITS.list ||
      !eligibleBarrels(action.catalog).some((item) => item.id === action.itemId)
    )
      return doc
    entries.push({ itemId: action.itemId, media: null })
  } else {
    if (index === -1) return doc
    if (action.kind === 'remove') entries.splice(index, 1)
    else {
      const target = index + action.direction
      if (target < 0 || target >= entries.length) return doc
      ;[entries[index], entries[target]] = [entries[target], entries[index]]
    }
  }
  return {
    ...doc,
    modules: doc.modules.map((entry) =>
      entry === module ? { ...module, content: { ...module.content, entries } } : entry,
    ),
  }
}

/** Chave do problema (e do campo) do texto alternativo da imagem de uma entrada, pelo itemId. */
export const entryAltKey = (itemId: string) => `entries.${itemId}.media.alt`

type Entry = Extract<
  CmsDocumentV2['modules'][number],
  { template: 'carousel' }
>['content']['entries'][number]

/** Altera só a entrada do `itemId` (nunca por posição); sem a entrada, devolve o mesmo documento. */
function withEntry(
  doc: CmsDocumentV2,
  moduleId: string,
  itemId: string,
  change: (entry: Entry) => Entry,
): CmsDocumentV2 {
  const module = doc.modules.find((entry) => entry.id === moduleId)
  if (module?.template !== 'carousel') return doc
  const index = module.content.entries.findIndex((entry) => entry.itemId === itemId)
  if (index === -1) return doc
  const current = module.content.entries[index]
  const next = change(current)
  if (JSON.stringify(next) === JSON.stringify(current)) return doc
  const entries = module.content.entries.map((entry, at) => (at === index ? next : entry))
  return {
    ...doc,
    modules: doc.modules.map((entry) =>
      entry === module ? { ...module, content: { ...module.content, entries } } : entry,
    ),
  }
}

/** Associa a imagem da biblioteca à entrada; o texto alternativo já escrito é mantido para conferência. */
export const setEntryMedia = (doc: CmsDocumentV2, moduleId: string, itemId: string, id: string) =>
  withEntry(doc, moduleId, itemId, (entry) => ({
    ...entry,
    media: { id, alt: entry.media?.alt ?? '' },
  }))

/** Desassocia a imagem da entrada. O arquivo continua na biblioteca. */
export const clearEntryMedia = (doc: CmsDocumentV2, moduleId: string, itemId: string) =>
  withEntry(doc, moduleId, itemId, (entry) => ({ ...entry, media: null }))

export const setEntryAlt = (doc: CmsDocumentV2, moduleId: string, itemId: string, alt: string) =>
  withEntry(doc, moduleId, itemId, (entry) =>
    entry.media ? { ...entry, media: { ...entry.media, alt } } : entry,
  )

import { cmsMediaIds } from '../../server/cms/media-contract'
import * as legacy from '../../server/cms/validation'
import type { CmsDocument, CmsDocumentV2 } from '../../shared/cms'
import { cmsDocument } from './cms-document-fixture'

// Baseline adapters expose old behaviour before CP1 exists; removing a new API regresses these tests.
const api = legacy as unknown as Record<string, (...args: unknown[]) => any>
export const parse = (input: unknown, mode = 'draft') =>
  (api.parseCmsDocument ?? legacy.validateCmsDocument)(input, mode as 'draft')
export const mutation = (input: unknown) =>
  (api.parseCmsMutation ?? legacy.validateCmsMutation)(input)
export const convert = (input: CmsDocument) =>
  api.convertCmsV1ToV2
    ? api.convertCmsV1ToV2(input)
    : { document: structuredClone(input), mapping: [], losses: [], warnings: [] }
export const refs = (input: unknown): string[] =>
  api.collectMediaRefs ? api.collectMediaRefs(input) : cmsMediaIds(input as CmsDocument)
export const project = (input: unknown) =>
  (api.projectPublicCmsV2 ?? legacy.projectPublicCms)(input)
export const uuid = (n = 1) => `12345678-1234-4123-8123-${String(n).padStart(12, '0')}`
export const media = (n = 1) => ({ id: `media_${uuid(n)}`, alt: `Image ${n}` })
export const carousel = () => ({
  id: `module_${uuid()}`,
  template: 'carousel' as const,
  visible: true,
  navigation: 'primary' as const,
  content: {
    heading: 'Barris',
    lead: 'Escolha',
    media: null,
    entries: [{ itemId: 'dronken', media: null }],
  },
})
export const v2 = (): CmsDocumentV2 => {
  const old = cmsDocument()
  return {
    schemaVersion: 2,
    commercial: old.commercial,
    modules: [old.modules[0], carousel(), old.modules[1], old.modules[2]].map((m) => {
      const { region: _region, ...module } = m as typeof m & { region?: string }
      return module
    }) as CmsDocumentV2['modules'],
  }
}
export const institutional = (template: 'how' | 'about' | 'highlight' | 'faq', n: number) => ({
  id: `module_${uuid(n)}`,
  template,
  visible: true,
  navigation: 'none',
  content:
    template === 'how'
      ? { heading: 'Como', steps: [{ title: 'Pedir', body: 'Combinar' }] }
      : template === 'faq'
        ? { heading: 'FAQ', items: [{ question: 'Como?', answer: 'Converse' }] }
        : { heading: 'Título', body: 'Texto', media: null },
})

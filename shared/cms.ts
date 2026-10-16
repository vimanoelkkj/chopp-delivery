// No renderer, persistence or public application imports this contract in L0A.2.
export type CmsMediaRef = { id: string; alt: string }
type Editorial = { heading: string; body: string; media: CmsMediaRef | null }
export type CmsContents = {
  hero: { heading: string; summary: string; media: CmsMediaRef | null }
  catalog: { heading: string; intro: string }
  contact: { heading: string; body: string }
  about: Editorial
  barrels: Editorial
  highlight: Editorial
  how: { heading: string; steps: { title: string; body: string }[] }
  faq: { heading: string; items: { question: string; answer: string }[] }
  ticker: { items: string[] }
}
export type CmsTemplate = keyof CmsContents
export type CmsRegion = 'start' | 'intro' | 'catalog' | 'details' | 'end'
export type CmsNavigation = 'none' | 'primary' | 'cta'
export type CmsModule = {
  [K in CmsTemplate]: {
    id: string
    template: K
    region: CmsRegion
    visible: boolean
    navigation: CmsNavigation
    content: CmsContents[K]
  }
}[CmsTemplate]
export type CmsCommercial = { fulfillmentMode: 'delivery'; whatsappNumber: string | null }
export type CmsDocument = { schemaVersion: 1; commercial: CmsCommercial; modules: CmsModule[] }
export type CmsMutation = {
  action: 'saveDraft' | 'publish'
  expectedRevision: string
  operationId: string
  document: CmsDocument
}
export type CmsAdminSnapshot = {
  draft: { revision: string; document: CmsDocument }
  published: { versionId: string; revision: string; document: CmsDocument } | null
}
export type PublicCms = {
  schemaVersion: 1
  commercial: { fulfillmentMode: 'delivery'; whatsappNumber: string }
  modules: (Omit<CmsModule, 'visible'> & { anchor: string | null })[]
}
export const CMS_LIMITS = { bytes: 65536, modules: 24, heading: 120, text: 2000, list: 12 }
// These anchors and delivery/legal policies are owned by code, never editable CMS data.
export const CMS_RULES: Record<
  CmsTemplate,
  {
    region: CmsRegion
    max: number
    anchor: string | null
    navigation: CmsNavigation
  }
> = {
  hero: { region: 'start', max: 1, anchor: 'inicio', navigation: 'none' },
  catalog: { region: 'catalog', max: 1, anchor: 'chopes', navigation: 'primary' },
  contact: { region: 'end', max: 1, anchor: 'contato', navigation: 'cta' },
  about: { region: 'details', max: 1, anchor: null, navigation: 'none' },
  barrels: { region: 'details', max: 1, anchor: 'barris', navigation: 'primary' },
  how: { region: 'details', max: 1, anchor: 'como', navigation: 'primary' },
  faq: { region: 'details', max: 1, anchor: 'faq', navigation: 'primary' },
  highlight: { region: 'details', max: 3, anchor: null, navigation: 'none' },
  ticker: { region: 'intro', max: 1, anchor: null, navigation: 'none' },
}

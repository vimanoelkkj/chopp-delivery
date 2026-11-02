import type { CmsCommercial, CmsMediaRef, CmsNavigation } from './common'
import type { CmsContents, CmsDocument as CmsDocumentV1, CmsModule } from './v1'

export type CmsCarouselEntry = { itemId: string; media: CmsMediaRef | null }
export type CmsContentsV2 = Omit<CmsContents, 'barrels'> & {
  carousel: {
    heading: string
    lead: string
    /** Referência editorial; função visual não definida. */
    media: CmsMediaRef | null
    entries: CmsCarouselEntry[]
  }
}
export type CmsTemplateV2 = keyof CmsContentsV2
export type CmsModuleV2 = {
  [K in CmsTemplateV2]: {
    id: string
    template: K
    visible: boolean
    navigation: CmsNavigation
    content: CmsContentsV2[K]
  }
}[CmsTemplateV2]
export type CmsDocumentV2 = { schemaVersion: 2; commercial: CmsCommercial; modules: CmsModuleV2[] }
export type CmsAnyDocument = CmsDocumentV1 | CmsDocumentV2
export type CmsWarning = 'COMPOSITION_WITHOUT_CAROUSEL' | 'CAROUSEL_HIDDEN' | 'CAROUSEL_EMPTY'
export type CmsAdminSnapshotV2 = {
  schema: 2
  draft: { revision: string; document: CmsDocumentV2 }
  published: { versionId: string; revision: string; document: CmsDocumentV2 } | null
  warnings?: string[]
}
export type CmsVersionedAdminSnapshot =
  | CmsAdminSnapshotV2
  | {
      schema: 1
      draft: { revision: string; document: CmsDocumentV1 }
      published: null
      warnings?: string[]
    }
  | {
      schema: null
      draft: { revision: string; document: null }
      published: null
      warnings?: string[]
    }
export type CmsMutationV2 = {
  action: 'saveDraft' | 'publish'
  expectedRevision: string
  operationId: string
  document: CmsDocumentV2
}
export type CmsVersionedCommandResult = {
  command: {
    operationId: string
    action: 'saveDraft' | 'convertToV2' | 'startV2'
    expectedRevision: string
    revision: string
    versionId: string
  }
  site: CmsVersionedAdminSnapshot
}
export type CmsConversionIntent = {
  action: 'previewConversion' | 'convertToV2' | 'startV2'
  expectedRevision: string
  operationId: string
  document?: CmsDocumentV2
  acknowledge?: string[]
}
export type PublicCmsV2 = {
  schemaVersion: 2
  commercial: { fulfillmentMode: 'delivery'; whatsappNumber: string }
  modules: {
    [K in CmsTemplateV2]: Omit<Extract<CmsModuleV2, { template: K }>, 'visible'> & {
      anchor: string | null
    }
  }[CmsTemplateV2][]
}
export const CMS_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
export const CMS_RULES_V2: Record<
  CmsTemplateV2,
  { rank: number; max: number; anchor: string | null; navigation: CmsNavigation }
> = {
  hero: { rank: 0, max: 1, anchor: 'inicio', navigation: 'none' },
  carousel: { rank: 1, max: 1, anchor: 'barris', navigation: 'primary' },
  ticker: { rank: 2, max: 1, anchor: null, navigation: 'none' },
  catalog: { rank: 3, max: 1, anchor: 'chopes', navigation: 'primary' },
  how: { rank: 4, max: 1, anchor: 'como', navigation: 'primary' },
  about: { rank: 4, max: 1, anchor: 'sobre', navigation: 'none' },
  highlight: { rank: 4, max: 3, anchor: null, navigation: 'none' },
  faq: { rank: 4, max: 1, anchor: 'faq', navigation: 'primary' },
  contact: { rank: 5, max: 1, anchor: 'contato', navigation: 'cta' },
}
export type CmsConversionMapping = {
  from: Pick<CmsModule, 'id' | 'template'>
  to: Pick<CmsModuleV2, 'id' | 'template'>
}

export type CmsConversionRequest = {
  expectedRevision: string
  operationId: string
  acknowledge?: string[]
} & (
  | { action: 'previewConversion' | 'convertToV2'; document?: never }
  | { action: 'startV2'; document: CmsDocumentV2 }
)

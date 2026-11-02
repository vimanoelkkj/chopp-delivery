// Compatibility facade: active DTOs remain v1 until the CP3 HTTP transition.
export * from './cms/common'
export * from './cms/layout'
export type { CmsDocument as CmsDocumentV1, CmsModule as CmsModuleV1 } from './cms/v1'
export * from './cms/v1'
export * from './cms/v2'

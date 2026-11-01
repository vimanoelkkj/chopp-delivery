export type CmsMediaRef = { id: string; alt: string }
export type CmsNavigation = 'none' | 'primary' | 'cta'
export type CmsCommercial = { fulfillmentMode: 'delivery'; whatsappNumber: string | null }
export const CMS_LIMITS = { bytes: 65536, modules: 24, heading: 120, text: 2000, list: 12 }

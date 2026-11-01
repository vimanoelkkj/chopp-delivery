import type { CmsDocument } from '../../shared/cms'

export const cmsDocument = (): CmsDocument => ({
  schemaVersion: 1,
  commercial: { fulfillmentMode: 'delivery', whatsappNumber: null },
  modules: [
    {
      id: 'hero',
      template: 'hero',
      region: 'start',
      visible: true,
      navigation: 'none',
      content: { heading: '', summary: '', media: null },
    },
    {
      id: 'catalog',
      template: 'catalog',
      region: 'catalog',
      visible: true,
      navigation: 'primary',
      content: { heading: '', intro: '' },
    },
    {
      id: 'contact',
      template: 'contact',
      region: 'end',
      visible: true,
      navigation: 'cta',
      content: { heading: '', body: '' },
    },
  ],
})

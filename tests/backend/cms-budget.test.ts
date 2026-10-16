import { expect, it } from 'vitest'
import { validateCmsDocument } from '../../server/cms/validation'
import { CMS_LIMITS, type CmsDocument, type CmsModule } from '../../shared/cms'

it('aceita exatamente 65536 bytes UTF-8 e recusa um byte a mais com campos válidos', () => {
  const steps = Array.from({ length: 12 }, () => ({
    title: 'T'.repeat(120),
    body: 'x'.repeat(2000),
  }))
  const items = Array.from({ length: 12 }, () => ({
    question: 'Q'.repeat(120),
    answer: 'x'.repeat(2000),
  }))
  const id = (n: number) => `module_12345678-1234-4123-8123-${String(n).padStart(12, '0')}`
  const modules: CmsModule[] = [
    {
      id: 'hero',
      template: 'hero',
      region: 'start',
      visible: true,
      navigation: 'none',
      content: { heading: 'H'.repeat(120), summary: '😀'.repeat(2000), media: null },
    },
    {
      id: 'catalog',
      template: 'catalog',
      region: 'catalog',
      visible: true,
      navigation: 'primary',
      content: { heading: 'C', intro: 'x'.repeat(2000) },
    },
    {
      id: id(1),
      template: 'how',
      region: 'details',
      visible: true,
      navigation: 'none',
      content: { heading: 'Como', steps },
    },
    {
      id: id(2),
      template: 'faq',
      region: 'details',
      visible: true,
      navigation: 'none',
      content: { heading: 'FAQ', items },
    },
    ...(['about', 'barrels', 'highlight', 'highlight', 'highlight'] as const).map(
      (template, index) => ({
        id: id(index + 3),
        template,
        region: 'details' as const,
        visible: true,
        navigation: 'none' as const,
        content: { heading: 'Título', body: 'x'.repeat(2000), media: null },
      }),
    ),
    {
      id: 'contact',
      template: 'contact',
      region: 'end',
      visible: true,
      navigation: 'cta',
      content: { heading: 'Contato', body: 'x'.repeat(2000) },
    },
  ]
  const input: CmsDocument = {
    schemaVersion: 1,
    commercial: { fulfillmentMode: 'delivery', whatsappNumber: null },
    modules,
  }
  const bytes = () => new TextEncoder().encode(JSON.stringify(input)).byteLength
  expect(bytes()).toBeGreaterThan(CMS_LIMITS.bytes)
  expect(validateCmsDocument(input, 'draft').fields).toHaveProperty('document.bytes')
  let boundary = steps[0]
  for (const step of steps) {
    const remove = Math.min(step.body.length, bytes() - CMS_LIMITS.bytes)
    step.body = step.body.slice(remove)
    boundary = step
    if (bytes() === CMS_LIMITS.bytes) break
  }
  expect(bytes()).toBe(CMS_LIMITS.bytes)
  expect(validateCmsDocument(input, 'draft').value).toEqual(input)
  boundary.body += 'x'
  expect(boundary.body.length).toBeLessThanOrEqual(CMS_LIMITS.text)
  expect(bytes()).toBe(CMS_LIMITS.bytes + 1)
  expect(validateCmsDocument(input, 'draft').fields).toHaveProperty('document.bytes')
})

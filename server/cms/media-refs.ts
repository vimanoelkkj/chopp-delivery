import type { CmsAnyDocument } from '../../shared/cms'
export function collectMediaRefs(document: CmsAnyDocument): string[] {
  const ids = new Set<string>()
  for (const module of document.modules) {
    if ('media' in module.content && module.content.media) ids.add(module.content.media.id)
    if (module.template === 'carousel')
      for (const entry of module.content.entries) if (entry.media) ids.add(entry.media.id)
  }
  return [...ids].sort()
}

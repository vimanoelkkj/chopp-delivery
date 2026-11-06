/** Same-origin path of a published media derivative. Authorization is decided server-side. */
export const CMS_PUBLIC_MEDIA_PROFILES = ['hero', 'section'] as const
export type CmsPublicMediaProfile = (typeof CMS_PUBLIC_MEDIA_PROFILES)[number]
export function publicMediaPath(id: string, profile: CmsPublicMediaProfile): string {
  return `/api/site/media/${encodeURIComponent(id)}/${profile}`
}

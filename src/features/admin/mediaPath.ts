import { cmsMediaId } from '../../../shared/cms/primitives'

export type MediaProfile = 'hero' | 'section'

/**
 * Endereço da entrega autenticada de um derivado (`GET /api/admin/media/:id/:profile`), ou `null`
 * se o ID não for de mídia. Só ID e perfil: o painel nunca conhece chave de armazenamento.
 * Fica fora de `site/media` para a prévia usá-lo sem carregar o cliente de comandos.
 */
export function mediaPath(id: string, profile: MediaProfile): string | null {
  return cmsMediaId(id) ? `/api/admin/media/${id}/${profile}` : null
}

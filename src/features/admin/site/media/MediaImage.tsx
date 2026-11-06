import { useEffect, useRef, useState } from 'react'
import { type MediaProfile, mediaPath } from '../../mediaPath'
import type { ThumbState } from './mediaModel'

/**
 * Imagem privada da biblioteca, entregue por `GET /api/admin/media/:id/:profile` (mesma origem, com a
 * sessão do painel). O resultado do carregamento é a única prova de que a imagem está disponível:
 * a entrega verifica os arquivos antes de enviá-los. Quem usa deve passar `key={id}` para reiniciar.
 */
export function MediaImage({
  id,
  profile,
  alt,
  className,
  onState,
  onSize,
}: {
  id: string
  profile: MediaProfile
  alt: string
  className?: string
  onState?: (state: ThumbState) => void
  onSize?: (size: { width: number; height: number }) => void
}) {
  const path = mediaPath(id, profile)
  const [state, setState] = useState<ThumbState>(path ? 'loading' : 'failed')
  const report = useRef(onState)
  report.current = onState
  useEffect(() => report.current?.(state), [state])
  if (!path || state === 'failed') return null
  return (
    <img
      className={className}
      src={path}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-media-state={state}
      onLoad={(event) => {
        const image = event.currentTarget
        onSize?.({ width: image.naturalWidth, height: image.naturalHeight })
        setState('ready')
      }}
      onError={() => setState('failed')}
    />
  )
}

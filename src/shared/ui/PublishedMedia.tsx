import { type ReactNode, useState } from 'react'
import { cmsMediaId } from '../../../shared/cms/primitives'
import { type CmsPublicMediaProfile, publicMediaPath } from '../../../shared/cms/public-media'
import styles from './PublishedMedia.module.css'

type LoadState = 'loading' | 'loaded' | 'failed'

/**
 * Imagem editorial publicada sobre o asset local aprovado.
 *
 * - O fallback permanece montado até a imagem carregar, então a altura do palco nunca muda e não
 *   há quadro vazio; a imagem publicada só substitui o fallback depois de `load`.
 * - Qualquer erro (HTTP, corpo inválido, rede) devolve o fallback; nunca exibe imagem quebrada.
 * - A URL vem exclusivamente de `publicMediaPath`; o ID é validado antes. O cache fica a cargo do
 *   endpoint (`no-cache` + ETag), sem camada manual aqui.
 * - O pai precisa ter `position: relative` e altura definida (como `KegCutout`).
 */
export function PublishedMedia({
  media,
  profile,
  fit,
  eager = true,
  fallback,
}: {
  media: { id: string; alt: string } | null | undefined
  profile: CmsPublicMediaProfile
  fit: 'cover' | 'contain'
  eager?: boolean
  fallback: ReactNode
}) {
  if (!media || !cmsMediaId(media.id)) return <>{fallback}</>
  // `key` reinicia o estado quando a publicação troca a mídia.
  return (
    <Loader
      key={`${media.id}:${profile}`}
      id={media.id}
      alt={media.alt}
      profile={profile}
      fit={fit}
      eager={eager}
      fallback={fallback}
    />
  )
}

function Loader({
  id,
  alt,
  profile,
  fit,
  eager,
  fallback,
}: {
  id: string
  alt: string
  profile: CmsPublicMediaProfile
  fit: 'cover' | 'contain'
  eager: boolean
  fallback: ReactNode
}) {
  const [state, setState] = useState<LoadState>('loading')
  if (state === 'failed') return <>{fallback}</>
  const loaded = state === 'loaded'
  return (
    <>
      {!loaded && fallback}
      <img
        src={publicMediaPath(id, profile)}
        // Enquanto carrega, a imagem é invisível e fora da árvore de acessibilidade.
        alt={loaded ? alt : ''}
        aria-hidden={loaded ? undefined : true}
        className={`${styles.image} ${fit === 'cover' ? styles.cover : styles.contain} ${
          loaded ? styles.loaded : ''
        }`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
    </>
  )
}

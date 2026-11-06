import { useEffect, useRef, useState } from 'react'
import type { MediaRef } from '../editModel'
import styles from './MediaFrame.module.css'
import { MediaImage } from './MediaImage'
import { frameCrops, SELECTED_UNAVAILABLE, type ThumbState } from './mediaModel'

/** Private draft only. The caller supplies the frame; no public media URL or publication is used. */
export function MediaFrame({
  media,
  profile,
  fit,
}: {
  media: MediaRef
  profile: 'hero' | 'section'
  fit: 'contain' | 'cover'
}) {
  return <Frame key={`${media.id}:${profile}:${fit}`} media={media} profile={profile} fit={fit} />
}

function Frame({ media, profile, fit }: Parameters<typeof MediaFrame>[0]) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ThumbState>('loading')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [image, setImage] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const box = element.getBoundingClientRect()
      setSize({ width: box.width, height: box.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const cropped = state === 'ready' ? frameCrops(fit, size, image) : null
  return (
    <div
      ref={ref}
      className={styles.frame}
      data-media-fit={fit}
      data-media-cropped={cropped ?? 'unknown'}
      data-media-state={state}
    >
      <MediaImage
        id={media.id}
        profile={profile}
        alt={media.alt}
        className={`${styles.image} ${fit === 'cover' ? styles.cover : styles.contain}`}
        onState={setState}
        onSize={setImage}
      />
      {state !== 'ready' ? (
        <span className={styles.empty} role={state === 'failed' ? 'alert' : 'status'}>
          {state === 'failed' ? SELECTED_UNAVAILABLE : 'Carregando a imagem…'}
        </span>
      ) : null}
      {state === 'ready' && cropped !== null ? (
        <span className={styles.note} role="status" aria-live="polite">
          {fit === 'contain'
            ? 'Imagem inteira · sem recorte'
            : cropped
              ? 'Recorte central neste enquadramento'
              : 'Imagem inteira neste enquadramento'}
        </span>
      ) : null}
    </div>
  )
}

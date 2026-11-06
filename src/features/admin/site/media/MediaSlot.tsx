import { useState } from 'react'
import type { CmsModuleV2 } from '../../../../../shared/cms/v2'
import { AdminButton } from '../../ui/AdminButton'
import { EditorField } from '../EditorField'
import { ALT_LIMIT, type MediaRef, problemKey } from '../editModel'
import styles from './Media.module.css'
import { MediaFrame } from './MediaFrame'
import { MediaImage } from './MediaImage'
import { SELECTED_UNAVAILABLE, shortId, type ThumbState } from './mediaModel'

/** Pré-visualização da imagem escolhida. Quem passa `key={id}` reinicia o estado ao trocar de imagem. */
function SlotPreview({ media, profile }: { media: MediaRef; profile: 'hero' | 'section' }) {
  const [state, setState] = useState<ThumbState>('loading')
  return (
    <div className={styles.preview} data-media-state={state}>
      <MediaImage
        id={media.id}
        profile={profile}
        alt={media.alt}
        className={styles.previewImage}
        onState={setState}
      />
      {state === 'loading' ? (
        <span className={styles.previewEmpty} role="status">
          Carregando a imagem…
        </span>
      ) : null}
      {state === 'failed' ? (
        <span className={styles.previewEmpty} role="alert">
          {SELECTED_UNAVAILABLE}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Imagem de uma seção (hero, sobre, destaque): escolher da biblioteca, trocar, remover e descrever.
 * Tudo aqui altera só o rascunho local; a associação só é gravada por "Salvar rascunho".
 */
export function MediaSlot({
  moduleId,
  template,
  media,
  problem,
  disabled,
  onChoose,
  onClear,
  onAltChange,
}: {
  moduleId: string
  template: CmsModuleV2['template']
  media: MediaRef | null
  problem?: string
  disabled: boolean
  onChoose: () => void
  onClear: () => void
  onAltChange: (alt: string) => void
}) {
  return (
    <div className={styles.slot} data-media-slot={moduleId}>
      <div className={styles.slotHead}>
        <p className={styles.slotTitle}>Imagem</p>
        <div className={styles.slotActions}>
          <AdminButton
            variant="outline"
            data-pick={moduleId}
            disabled={disabled}
            onClick={onChoose}
          >
            {media ? 'Trocar imagem' : 'Escolher imagem'}
          </AdminButton>
          {media ? (
            <AdminButton variant="outline" disabled={disabled} onClick={onClear}>
              Remover imagem
            </AdminButton>
          ) : null}
        </div>
      </div>

      {media ? (
        <>
          {template === 'hero' || template === 'about' ? (
            <>
              <div className={`${styles.preview} ${styles.framedPreview}`}>
                <MediaFrame
                  media={media}
                  profile={template === 'hero' ? 'hero' : 'section'}
                  fit={template === 'hero' ? 'contain' : 'cover'}
                />
              </div>
              <p className={styles.slotNote}>
                {template === 'hero'
                  ? 'Hero: a imagem cabe inteira, sem recorte.'
                  : 'Sobre: a imagem preenche o quadro e pode ter recorte central.'}{' '}
                Esta é uma amostra 4:3. Confira o enquadramento real na prévia da página em desktop
                e celular depois de salvar o rascunho.
              </p>
            </>
          ) : (
            <SlotPreview key={media.id} media={media} profile="section" />
          )}
          <p className={styles.slotNote}>
            Imagem {shortId(media.id)}. Trocar escolhe outra imagem da biblioteca; a atual não é
            alterada nem apagada.
          </p>
          <EditorField
            fieldKey={problemKey(moduleId, 'media.alt')}
            label="Texto alternativo da imagem"
            value={media.alt}
            long={false}
            limit={ALT_LIMIT}
            hint="Descreva a imagem para quem não a enxerga. Ao trocar a imagem, confira se o texto ainda serve."
            problem={problem}
            disabled={disabled}
            onChange={onAltChange}
          />
          {media.alt.trim() === '' ? (
            <p className={styles.slotWarn}>
              Sem texto alternativo. O rascunho aceita, mas a publicação vai exigir.
            </p>
          ) : null}
        </>
      ) : (
        <div className={styles.preview}>
          <span className={styles.previewEmpty}>
            Sem imagem. A página usa a imagem padrão até você escolher uma.
          </span>
        </div>
      )}

      {media === null && template === 'hero' ? (
        <p className={styles.slotNote}>
          A abertura precisará de uma imagem para ser publicada; o rascunho aceita sem.
        </p>
      ) : null}
      {template === 'hero' || template === 'about' ? (
        <p className={styles.slotNote}>
          Remover imagem apenas desassocia deste rascunho; não exclui o arquivo da biblioteca. A
          vitrine mantém a imagem publicada até uma nova publicação.
        </p>
      ) : null}
    </div>
  )
}

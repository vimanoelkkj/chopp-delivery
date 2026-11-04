import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AdminButton } from '../../ui/AdminButton'
import { Modal } from '../../ui/Modal'
import styles from './Media.module.css'
import { MediaImage } from './MediaImage'
import type { MediaItem } from './mediaApi'
import {
  capacityView,
  listFailureText,
  MEDIA_ACCEPT,
  shortId,
  type ThumbState,
  tileView,
  UPLOAD_RULES,
  uploadFailureText,
} from './mediaModel'
import { useMediaLibrary } from './useMediaLibrary'
import { type UploadPhase, useMediaUpload } from './useMediaUpload'

type Tone = 'info' | 'ok' | 'bad' | 'warn'

type Feedback = {
  tone: Tone
  title?: string
  text: string
  /** `status` para andamento e sucesso; `alert` para o que exige atenção. */
  role: 'status' | 'alert'
}

function feedbackOf(phase: UploadPhase): Feedback | null {
  switch (phase.kind) {
    case 'idle':
      return null
    case 'checking':
      return { tone: 'info', role: 'status', text: `Conferindo ${phase.name}…` }
    case 'uploading':
      return {
        tone: 'info',
        role: 'status',
        text: `Enviando e processando ${phase.name}. Pode levar alguns segundos; não feche esta janela.`,
      }
    case 'confirming':
      return {
        tone: 'info',
        role: 'status',
        text: `Confirmando com o servidor se ${phase.name} foi recebida. Nada será reenviado sozinho.`,
      }
    case 'done':
      return {
        tone: 'ok',
        role: 'status',
        title: `Imagem ${shortId(phase.media.id)} enviada`,
        text: 'Ela já está selecionada. Nada foi salvo no rascunho ainda: use “Usar esta imagem” e depois “Salvar rascunho”.',
      }
    case 'refused':
      return {
        tone: 'warn',
        role: 'alert',
        title: 'Esta imagem não foi enviada',
        text: `${phase.message} Nada foi enviado e nenhum registro da cota foi usado.`,
      }
    case 'failed': {
      const message = uploadFailureText(phase.failure)
      return { tone: 'bad', role: 'alert', title: message.title, text: message.text }
    }
    case 'uncertain': {
      const base = uploadFailureText({ kind: 'unknown' })
      const detail = {
        unknown: 'O recibo também não pôde ser consultado. Nada será reenviado sozinho.',
        running:
          'O servidor ainda mostra este envio em andamento. Não envie de novo; verifique em instantes.',
        absent:
          'O servidor ainda não tem registro deste envio. Repetir a mesma operação é seguro: o servidor não duplica o que já recebeu.',
      }[phase.why]
      return { tone: 'warn', role: 'alert', title: base.title, text: `${base.text} ${detail}` }
    }
  }
}

function Tile({
  item,
  selected,
  inUse,
  onPick,
  onThumb,
}: {
  item: MediaItem
  selected: boolean
  inUse: boolean
  onPick: () => void
  onThumb: (state: ThumbState) => void
}) {
  const [thumb, setThumb] = useState<ThumbState>('loading')
  const view = tileView(item, item.state === 'ready' ? thumb : 'failed')
  const choice = useId()
  return (
    <label className={styles.tile} data-selected={selected} data-tone={view.tone} htmlFor={choice}>
      <input
        id={choice}
        className={styles.radio}
        type="radio"
        name="media-choice"
        value={item.id}
        checked={selected}
        disabled={!view.selectable}
        onChange={onPick}
      />
      <span className={styles.thumb}>
        {item.state === 'ready' ? (
          <MediaImage
            key={item.id}
            id={item.id}
            profile="section"
            alt=""
            className={styles.thumbImage}
            onState={(state) => {
              setThumb(state)
              onThumb(state)
            }}
          />
        ) : null}
        {item.state !== 'ready' || thumb === 'failed' ? (
          <span aria-hidden="true">
            {item.state === 'ready' ? 'Arquivo não entregue' : 'Sem prévia'}
          </span>
        ) : null}
      </span>
      <span className={styles.tileText}>
        <span className={styles.tileName}>Imagem {shortId(item.id)}</span>
        <span className={styles.tileStatus} data-tone={view.tone}>
          {view.label}
        </span>
        {inUse ? <span className={styles.inUse}>Em uso nesta página</span> : null}
      </span>
    </label>
  )
}

/**
 * Janela de escolha da imagem de uma seção: cota, envio de novas imagens e galeria paginada.
 * Escolher uma imagem só devolve o ID ao editor; quem persiste a associação é "Salvar rascunho".
 */
export function MediaPicker({
  open,
  target,
  used,
  onClose,
  onClosed,
  onChoose,
  onExpired,
}: {
  open: boolean
  /** Título da seção que vai receber a imagem. */
  target: string
  /** IDs já usados no documento (marcados na galeria). */
  used: ReadonlySet<string>
  onClose: () => void
  /** Depois que a janela fechou de vez (foco já devolvido ao botão que a abriu). */
  onClosed?: () => void
  onChoose: (id: string) => void
  onExpired: () => void
}) {
  const titleId = useId()
  const uploadId = useId()
  const input = useRef<HTMLInputElement>(null)
  const feedbackRef = useRef<HTMLParagraphElement>(null)
  const [candidate, setCandidate] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, ThumbState>>({})
  const { library, load, more } = useMediaLibrary({ onExpired })
  const upload = useMediaUpload({
    onUploaded: (media) => {
      setCandidate(media.id)
      void load()
    },
    onExpired,
  })

  const wasOpen = useRef(false)
  const { kind: uploadKind } = upload.phase
  const resetUpload = upload.reset
  useEffect(() => {
    if (open && !wasOpen.current) {
      setCandidate(null)
      setThumbs({})
      void load()
      // Resultado antigo (sucesso, recusa, falha) não vale numa nova abertura; envio em andamento ou incerto, sim.
      if (uploadKind === 'done' || uploadKind === 'refused' || uploadKind === 'failed')
        resetUpload()
    }
    wasOpen.current = open
  }, [open, load, uploadKind, resetUpload])

  const feedback = feedbackOf(upload.phase)
  useEffect(() => {
    if (feedback?.role === 'alert') feedbackRef.current?.focus()
  }, [feedback?.role])

  const rememberThumb = useCallback(
    (id: string, state: ThumbState) =>
      setThumbs((current) => (current[id] === state ? current : { ...current, [id]: state })),
    [],
  )

  const capacity = library.capacity ? capacityView(library.capacity) : null
  const unsupported = library.failure?.kind === 'unsupported'
  const chosen = library.items.find((item) => item.id === candidate)
  const chosenReady = chosen ? tileView(chosen, thumbs[chosen.id] ?? 'loading').selectable : false
  const uncertainLocked = upload.phase.kind === 'uncertain'
  const uploadBlocked =
    library.status !== 'ready' || library.capacity?.remaining === 0 || uncertainLocked
  const failure = library.failure ? listFailureText(library.failure) : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!upload.working}
      titleId={titleId}
      onClosed={onClosed}
      wide
    >
      <h2 id={titleId} className={styles.title}>
        Escolher imagem
      </h2>
      <p className={styles.lead}>
        Para “{target}”. A biblioteca é privada e escolher uma imagem não publica nada.
      </p>

      {capacity && library.capacity ? (
        <section className={styles.block} aria-label="Capacidade da biblioteca">
          <p className={styles.capacityLine} data-level={capacity.level}>
            <span>{capacity.used}</span>
            <span>{capacity.remaining}</span>
          </p>
          <progress
            className={styles.meter}
            data-level={capacity.level}
            value={library.capacity.consumed}
            max={library.capacity.limit}
            aria-label={capacity.used}
          />
          <p className={styles.hint}>{capacity.note}</p>
        </section>
      ) : null}

      {unsupported ? null : (
        <section className={styles.block} aria-labelledby={uploadId}>
          <h3 id={uploadId} className={styles.blockTitle}>
            Enviar nova imagem
          </h3>
          <p className={styles.hint}>{UPLOAD_RULES}</p>
          <div className={styles.uploadRow}>
            <AdminButton
              variant="outline"
              pending={upload.working}
              disabled={uploadBlocked && !upload.working}
              onClick={() => input.current?.click()}
            >
              {upload.working ? 'Enviando…' : 'Escolher arquivo…'}
            </AdminButton>
            <input
              ref={input}
              className={styles.fileInput}
              type="file"
              disabled={uploadBlocked || upload.working}
              accept={MEDIA_ACCEPT}
              tabIndex={-1}
              aria-label="Arquivo de imagem"
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Permite escolher o mesmo arquivo de novo depois de uma falha.
                event.target.value = ''
                if (file) void upload.start(file)
              }}
            />
            {library.capacity?.remaining === 0 ? (
              <span className={styles.hint}>
                A cota acabou: só é possível escolher imagens já enviadas.
              </span>
            ) : null}
          </div>
          {feedback ? (
            <p
              ref={feedbackRef}
              tabIndex={-1}
              role={feedback.role}
              className={styles.feedback}
              data-tone={feedback.tone}
            >
              {feedback.title ? (
                <strong className={styles.feedbackTitle}>{feedback.title}</strong>
              ) : null}
              <span className={styles.feedbackText}>{feedback.text}</span>
              {upload.phase.kind === 'uncertain' ? (
                <span className={styles.feedbackActions}>
                  <AdminButton onClick={() => void upload.verify()}>Verificar agora</AdminButton>
                  {upload.phase.canRepeat ? (
                    <AdminButton variant="outline" onClick={() => void upload.repeat()}>
                      Repetir o mesmo envio
                    </AdminButton>
                  ) : null}
                </span>
              ) : null}
            </p>
          ) : null}
        </section>
      )}

      {failure ? (
        <p role="alert" className={styles.feedback} data-tone={unsupported ? 'warn' : 'bad'}>
          <strong className={styles.feedbackTitle}>{failure.title}</strong>
          <span className={styles.feedbackText}>{failure.text}</span>
          {unsupported ? null : (
            <span className={styles.feedbackActions}>
              <AdminButton onClick={() => void load()}>Tentar de novo</AdminButton>
            </span>
          )}
        </p>
      ) : null}

      {library.status === 'ready' ? (
        <div className={styles.galleryHead}>
          <h3 className={styles.blockTitle}>Biblioteca</h3>
          <AdminButton variant="outline" pending={library.refreshing} onClick={() => void load()}>
            {library.refreshing ? 'Atualizando…' : 'Atualizar lista'}
          </AdminButton>
        </div>
      ) : null}

      {library.status === 'loading' ? (
        <>
          <p role="status" className={styles.hint}>
            Carregando a biblioteca…
          </p>
          <div className={styles.gallery} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={styles.skeleton} />
            ))}
          </div>
        </>
      ) : null}

      {library.status === 'ready' && library.items.length === 0 ? (
        <p className={styles.empty}>
          Ainda não há imagens na biblioteca. Envie a primeira com “Escolher arquivo…”.
        </p>
      ) : null}

      {library.items.length > 0 ? (
        <div role="radiogroup" aria-label="Imagens da biblioteca" className={styles.gallery}>
          {library.items.map((item) => (
            <Tile
              key={item.id}
              item={item}
              selected={candidate === item.id}
              inUse={used.has(item.id)}
              onPick={() => setCandidate(item.id)}
              onThumb={(state) => rememberThumb(item.id, state)}
            />
          ))}
        </div>
      ) : null}

      {library.nextCursor ? (
        <div className={styles.more}>
          <AdminButton variant="outline" pending={library.loadingMore} onClick={() => void more()}>
            {library.loadingMore ? 'Carregando…' : 'Carregar mais imagens'}
          </AdminButton>
        </div>
      ) : null}
      {library.moreFailed ? (
        <p role="alert" className={styles.hint}>
          Não foi possível carregar mais imagens agora. Tente de novo.
        </p>
      ) : null}

      <div className={styles.footer}>
        <p className={styles.footerNote} aria-live="polite">
          {chosen
            ? chosenReady
              ? `Imagem ${shortId(chosen.id)} escolhida. Ela só vale no rascunho depois de “Salvar rascunho”.`
              : 'Aguardando a verificação da imagem escolhida…'
            : 'Escolha uma imagem da lista.'}
        </p>
        <AdminButton variant="outline" disabled={upload.working} onClick={onClose}>
          Cancelar
        </AdminButton>
        <AdminButton
          disabled={!chosen || !chosenReady || upload.working}
          onClick={() => chosen && onChoose(chosen.id)}
        >
          Usar esta imagem
        </AdminButton>
      </div>
    </Modal>
  )
}

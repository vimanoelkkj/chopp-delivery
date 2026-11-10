import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { fieldProblem } from '../site/editModel'
import { MediaPicker } from '../site/media/MediaPicker'
import { MediaSlot } from '../site/media/MediaSlot'
import { AdminButton } from '../ui/AdminButton'
import { ImageApiError, type ImageState, productImages } from './imageApi'
import styles from './ProductImage.module.css'

type Media = { id: string; alt: string }
type Notice = { tone: 'ok' | 'bad'; text: string; reload?: boolean }

const same = (a: Media | null, b: Media | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.alt === b.alt)

function failureText(error: ImageApiError): Notice {
  switch (error.code) {
    case 'conflict':
      return {
        tone: 'bad',
        reload: true,
        text: 'A imagem deste produto foi alterada em outra sessão. Nada foi salvo e a sua escolha continua aqui. Ela não pode ser salva por cima: recarregue para ver a versão atual.',
      }
    case 'invalid':
      return {
        tone: 'bad',
        text: error.detail
          ? `O servidor recusou a imagem: ${error.detail}`
          : 'O servidor recusou a imagem. Ela pode ter sido excluída, recusada no processamento ou ainda estar processando. Escolha outra na biblioteca.',
      }
    case 'disabled':
      return {
        tone: 'bad',
        text: 'A troca de imagens está desativada neste ambiente. Nada foi salvo.',
      }
    case 'no-image':
      return {
        tone: 'bad',
        reload: true,
        text: 'Este produto já está sem imagem. Recarregue para ver o estado atual.',
      }
    case 'not-found':
      return {
        tone: 'bad',
        text: 'Produto não encontrado. Recarregue o painel antes de tentar de novo.',
      }
    case 'forbidden':
      return {
        tone: 'bad',
        text: 'O servidor não aceitou a origem do pedido. Nada foi salvo. Recarregue a página e entre de novo.',
      }
    default:
      return {
        tone: 'bad',
        reload: true,
        text: 'Não conseguimos confirmar se a imagem foi salva. Recarregue a imagem para ver o estado real antes de tentar de novo.',
      }
  }
}

/**
 * Imagem principal de um produto. Salva por conta própria (revisão `mN`), sem tocar nos preços e
 * variantes (revisão `rN`). Reutiliza o espaço de imagem e a biblioteca do editor da página inicial.
 */
export function ProductImagePanel({
  itemId,
  name,
  visible,
  onExpired,
}: {
  itemId: string
  name: string
  visible: boolean
  onExpired: () => void
}) {
  const panelId = useId()
  const [saved, setSaved] = useState<ImageState | null>(null)
  const [loadError, setLoadError] = useState<ImageApiError | null>(null)
  const [draft, setDraft] = useState<Media | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const afterPicker = useRef(false)
  const expired = useRef(onExpired)
  expired.current = onExpired
  const altKey = `product-image:${itemId}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` força a releitura
  useEffect(() => {
    const controller = new AbortController()
    setSaved(null)
    setLoadError(null)
    productImages
      .get(itemId, controller.signal)
      .then((state) => {
        setSaved(state)
        setDraft(state.mediaId && state.alt !== null ? { id: state.mediaId, alt: state.alt } : null)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        if (error instanceof ImageApiError && error.code === 'unauthenticated') expired.current()
        else setLoadError(error instanceof ImageApiError ? error : new ImageApiError('unavailable'))
      })
    return () => controller.abort()
  }, [itemId, attempt])

  const reload = useCallback(() => {
    setNotice(null)
    setAttempt((value) => value + 1)
  }, [])

  const current: Media | null = saved?.mediaId ? { id: saved.mediaId, alt: saved.alt ?? '' } : null
  const dirty = saved !== null && !same(draft, current)
  const altProblem = draft && draft.alt.trim() !== '' ? fieldProblem(draft.alt, 'alt') : null
  const valid = draft === null || (draft.alt.trim() !== '' && altProblem === null)
  const canSave = dirty && valid && !busy
  const used = useMemo(() => new Set(current ? [current.id] : []), [current])

  async function save() {
    if (!saved || !canSave) return
    setBusy(true)
    setNotice(null)
    try {
      const next = draft
        ? await productImages.put(itemId, saved.revision, {
            mediaId: draft.id,
            alt: draft.alt.trim(),
          })
        : await productImages.remove(itemId, saved.revision)
      setSaved(next)
      setDraft(next.mediaId && next.alt !== null ? { id: next.mediaId, alt: next.alt } : null)
      setNotice({
        tone: 'ok',
        text: next.mediaId
          ? visible
            ? 'Imagem salva. Ela já aparece na vitrine.'
            : 'Imagem salva. O produto está oculto: ela só aparece na vitrine quando ele for exibido.'
          : 'Imagem removida. A vitrine volta à foto atual do produto. O arquivo continua na biblioteca.',
      })
    } catch (error) {
      if (error instanceof ImageApiError && error.code === 'unauthenticated') expired.current()
      else
        setNotice(
          failureText(error instanceof ImageApiError ? error : new ImageApiError('unavailable')),
        )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.panel} id={panelId} aria-label={`Imagem principal de ${name}`}>
      <h3 className={styles.title}>Imagem principal</h3>
      <p className={styles.note}>
        Aparece na vitrine assim que for salva, para produto visível. A imagem editorial do
        carrossel, depois de publicada, substitui esta imagem só no carrossel.
        {visible
          ? ''
          : ' Este produto está oculto: a imagem fica guardada e só é entregue ao público quando ele for exibido.'}
      </p>
      {saved === null && loadError === null ? (
        <p role="status" className={styles.note}>
          Carregando a imagem…
        </p>
      ) : null}
      {loadError ? (
        <>
          <p role="alert" className={styles.bad}>
            {loadError.code === 'unavailable'
              ? 'Imagens de produto indisponíveis neste ambiente ou sem conexão. Nada foi alterado.'
              : failureText(loadError).text}
          </p>
          <div className={styles.actions}>
            <AdminButton variant="outline" onClick={reload}>
              Tentar de novo
            </AdminButton>
          </div>
        </>
      ) : null}
      {saved ? (
        <>
          <MediaSlot
            moduleId={`product:${itemId}`}
            template="highlight"
            title="Imagem do produto"
            subject={name}
            emptyText="Sem imagem principal. A vitrine usa a foto atual do produto ou a silhueta neutra."
            media={draft}
            altFieldKey={altKey}
            altWarning="Sem texto alternativo: ele é obrigatório para salvar a imagem."
            problem={altProblem ?? undefined}
            disabled={busy}
            onChoose={() => setPickerOpen(true)}
            onClear={() => setDraft(null)}
            onAltChange={(alt) => setDraft((media) => (media ? { ...media, alt } : media))}
          />
          <div className={styles.actions}>
            <AdminButton pending={busy} disabled={!canSave} onClick={save}>
              Salvar imagem
            </AdminButton>
            {dirty ? (
              <AdminButton variant="outline" disabled={busy} onClick={() => setDraft(current)}>
                Desfazer
              </AdminButton>
            ) : null}
          </div>
        </>
      ) : null}
      {notice ? (
        <>
          <p role={notice.tone === 'ok' ? 'status' : 'alert'} className={styles[notice.tone]}>
            {notice.text}
          </p>
          {notice.reload ? (
            <div className={styles.actions}>
              <AdminButton variant="outline" onClick={reload}>
                Recarregar imagem
              </AdminButton>
            </div>
          ) : null}
        </>
      ) : null}
      <MediaPicker
        open={pickerOpen}
        target={name}
        used={used}
        onClose={() => setPickerOpen(false)}
        onClosed={() => {
          if (!afterPicker.current) return
          afterPicker.current = false
          document.querySelector<HTMLElement>(`[data-field="${altKey}"]`)?.focus()
        }}
        onChoose={(id) => {
          afterPicker.current = true
          setDraft((media) => ({ id, alt: media?.alt ?? '' }))
          setPickerOpen(false)
        }}
        onExpired={() => expired.current()}
      />
    </section>
  )
}

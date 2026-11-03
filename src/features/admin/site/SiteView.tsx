import { useEffect, useMemo, useRef, useState } from 'react'
import { AdminButton } from '../ui/AdminButton'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { isDirty } from './editModel'
import { HomeEditor, type SiteRescue } from './HomeEditor'
import { ConvertPanel, StartPanel } from './InitFlow'
import styles from './SiteView.module.css'
import type { SiteRead } from './siteModel'
import { type SiteState, useSiteDocument } from './useSiteDocument'

const MESSAGES = {
  forbidden: {
    title: 'Sem permissão para ver a página inicial',
    text: 'Sua sessão está ativa, mas esta conta não pode consultar o rascunho. Fale com quem administra o painel.',
  },
  unavailable: {
    title: 'O CMS está indisponível no momento',
    text: 'O servidor respondeu que o CMS não está disponível. O catálogo continua funcionando. Tente de novo em instantes.',
  },
  error: {
    title: 'Não conseguimos carregar a página inicial',
    text: 'Nada foi alterado. Tente de novo em instantes.',
  },
} as const

type V2Read = Extract<SiteRead, { kind: 'v2' }>

function Body({
  state,
  retry,
  onApplied,
  onExpired,
  onSaveExpired,
  onDirtyChange,
  onSnapshotChange,
  onLockChange,
  restore,
  notice,
}: {
  state: SiteState
  retry: () => void
  onApplied: (read: V2Read, message: string) => void
  onExpired: () => void
  onSaveExpired: (rescue: { document: SiteRescue['document']; revision: string }) => void
  onDirtyChange: (dirty: boolean) => void
  onSnapshotChange: (snapshot: Omit<SiteRescue, 'userId'> | null) => void
  onLockChange: (locked: boolean) => void
  restore: SiteRescue | null
  notice: string | null
}) {
  if (state.status === 'loading')
    return (
      <div role="status" aria-label="Carregando a página inicial">
        <div className={styles.skeleton} aria-hidden="true">
          <span className={styles.skeletonBlock} />
          <span className={styles.skeletonBlock} />
          <span className={styles.skeletonBlock} />
        </div>
      </div>
    )
  if (state.status === 'expired')
    return (
      <p role="status" className={styles.message}>
        Sessão expirada. Voltando ao login…
      </p>
    )
  if (state.status === 'ready' && state.read.kind === 'v2')
    return (
      <>
        {notice ? (
          <p role="status" className={styles.success}>
            {notice}
          </p>
        ) : null}
        <HomeEditor
          read={state.read}
          restore={restore}
          onApplied={onApplied}
          onExpired={onSaveExpired}
          onDirtyChange={onDirtyChange}
          onSnapshotChange={onSnapshotChange}
          onLockChange={onLockChange}
          onReload={retry}
        />
      </>
    )
  // Sem documento ou rascunho v1: o fluxo explícito de início/conversão. Nada roda sozinho.
  if (state.status === 'ready' && state.read.kind === 'none')
    return (
      <StartPanel
        revision={state.read.revision}
        reload={retry}
        onApplied={onApplied}
        onExpired={onExpired}
      />
    )
  if (state.status === 'ready' && state.read.kind === 'v1')
    return (
      <ConvertPanel
        revision={state.read.revision}
        reload={retry}
        onApplied={onApplied}
        onExpired={onExpired}
      />
    )

  const message = MESSAGES[state.status as keyof typeof MESSAGES]
  const failed = state.status === 'error' || state.status === 'unavailable'
  return (
    <section className={styles.message} role={failed ? 'alert' : 'status'}>
      <h2 className={styles.messageTitle}>{message.title}</h2>
      <p className={styles.messageText}>{message.text}</p>
      {failed ? (
        <div className={styles.messageActions}>
          <AdminButton onClick={retry}>Tentar de novo</AdminButton>
        </div>
      ) : null}
    </section>
  )
}

/** Tela "Página inicial" do painel: edita o rascunho editorial do CMS v2. Nada é publicado. */
export function SiteView({
  userId,
  onExpired,
  rescue,
  onRescue,
  onRescueHandled,
  onDirtyChange,
}: {
  userId: string
  onExpired: () => void
  /** Alterações guardadas antes de a sessão expirar (devolvidas após novo login). */
  rescue: SiteRescue | null
  onRescue: (rescue: SiteRescue) => void
  onRescueHandled: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { state, reload, apply } = useSiteDocument(onExpired)
  const [notice, setNotice] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [locked, setLocked] = useState(false)
  const [confirmingRefresh, setConfirmingRefresh] = useState(false)
  const pendingRescue = useRef(rescue)
  const readyV2 = state.status === 'ready' && state.read.kind === 'v2' ? state.read : null
  const restore = useMemo(() => {
    const kept = pendingRescue.current
    return readyV2 && kept && kept.userId === userId && isDirty(readyV2.document, kept.document)
      ? kept
      : null
  }, [readyV2, userId])

  // Consome o rascunho guardado uma única vez: mantido em conflito se a revisão mudou, nunca descartado automaticamente.
  useEffect(() => {
    const kept = pendingRescue.current
    if (!readyV2 || !kept) return
    pendingRescue.current = null
    if (kept.userId !== userId) onRescueHandled()
    setNotice(
      kept.userId !== userId
        ? 'Não há alterações desta conta para restaurar.'
        : !isDirty(readyV2.document, kept.document)
          ? 'Suas alterações já constam no rascunho salvo. Nada foi reenviado.'
          : kept.revision === readyV2.revision
            ? 'Suas alterações foram restauradas depois do login. Confira e salve o rascunho.'
            : 'Suas alterações foram preservadas como conflito: a versão salva mudou. Copie seus textos antes de descartar e carregar a versão atual.',
    )
  }, [readyV2, userId, onRescueHandled])

  const changeDirty = (value: boolean) => {
    setDirty(value)
    onDirtyChange(value)
    if (value) setNotice(null)
  }
  const refresh = () => {
    if (locked) return
    onRescueHandled()
    setNotice(null)
    reload()
  }
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>Rascunho do CMS v2</p>
            <h1 className={styles.title}>Página inicial</h1>
          </div>
          <div className={styles.actions}>
            <a
              className={styles.link}
              href="/admin/preview"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir prévia
              <span className="visually-hidden"> (mostra só o último rascunho salvo)</span>
            </a>
            <AdminButton
              variant="outline"
              onClick={() => (dirty ? setConfirmingRefresh(true) : refresh())}
              disabled={state.status === 'loading' || locked}
            >
              Atualizar
            </AdminButton>
          </div>
        </div>
        <p className={styles.notice}>
          Nada é publicado por esta tela. Você edita o rascunho e só o que for salvo aparece na
          prévia; o site público continua independente do CMS.
        </p>
        <Body
          state={state}
          retry={refresh}
          onApplied={(read, message) => {
            apply(read)
            setNotice(message)
          }}
          onExpired={onExpired}
          onSaveExpired={(kept) => {
            onRescue({ ...kept, userId })
            onExpired()
          }}
          onDirtyChange={changeDirty}
          onSnapshotChange={(snapshot) => {
            if (snapshot) onRescue({ ...snapshot, userId })
            else onRescueHandled()
          }}
          onLockChange={setLocked}
          restore={restore}
          notice={notice}
        />
        <ConfirmDialog
          open={confirmingRefresh}
          title="Descartar as alterações e atualizar?"
          confirmLabel="Descartar e atualizar"
          cancelLabel="Continuar editando"
          onCancel={() => setConfirmingRefresh(false)}
          onConfirm={() => {
            setConfirmingRefresh(false)
            refresh()
          }}
        >
          Há alterações que ainda não foram salvas. Atualizar carrega o rascunho do servidor e
          descarta o que você editou.
        </ConfirmDialog>
      </div>
    </div>
  )
}

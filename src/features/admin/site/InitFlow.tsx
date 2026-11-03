import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { AdminButton } from '../ui/AdminButton'
import { Modal } from '../ui/Modal'
import { type Failure, previewConversion } from './cmsCommands'
import styles from './InitFlow.module.css'
import { buildInitialDocument, INITIAL_SECTION_COUNT } from './initialDocument'
import {
  type CommandReceipt,
  type ConversionView,
  describeConversion,
  type SiteRead,
} from './siteModel'
import { type RunPhase, useCommandRun } from './useCommandRun'

type V2Read = Extract<SiteRead, { kind: 'v2' }>

type FlowProps = {
  revision: string
  reload: () => void
  onApplied: (read: V2Read, message: string) => void
  onExpired: () => void
}

const CONFLICT_TEXT: Record<string, string> = {
  CMS_ALREADY_V2:
    'O documento já está no formato v2 (talvez criado por outra sessão). Nada foi gravado por esta operação. Atualize para vê-lo.',
  CMS_SCHEMA_MISMATCH:
    'O estado do documento mudou depois que você abriu esta tela (por exemplo, um rascunho antigo foi criado). Nada foi gravado por esta operação. Atualize para ver o estado atual.',
}

/** Texto de cada falha: sempre diz se algo foi gravado e o que o administrador pode fazer. */
function failureText(failure: Failure): { title: string; text: string } {
  switch (failure.kind) {
    case 'conflict':
      return {
        title: 'O documento mudou',
        text:
          CONFLICT_TEXT[failure.code] ??
          'Outra sessão alterou o documento depois que você abriu esta tela. Nada foi gravado por esta operação. Atualize para ver o estado atual antes de tentar de novo.',
      }
    case 'operation-conflict':
      return {
        title: 'Operação recusada',
        text: 'Esta operação já tinha sido usada com outros dados. Nada foi gravado. Atualize e comece de novo.',
      }
    case 'acknowledgement':
      return {
        title: 'Faltou reconhecer um aviso',
        text: 'A conversão exige reconhecer todos os avisos. Nada foi gravado. Atualize a prévia e confirme de novo.',
      }
    case 'invalid':
      return {
        title: 'O servidor recusou o pedido',
        text: `Nada foi gravado.${failure.code ? ` (${failure.code})` : ''}`,
      }
    case 'forbidden':
      return {
        title: 'Pedido recusado pelo servidor',
        text: 'O servidor não aceitou a origem do pedido (proteção contra requisições de outro site). Nada foi gravado. Recarregue a página, entre de novo e tente outra vez.',
      }
    case 'unavailable':
      return {
        title: 'O CMS v2 ainda não está disponível',
        text: 'O servidor ainda não tem o CMS v2 pronto. Nada foi gravado. Você pode tentar de novo em instantes.',
      }
    case 'unknown':
      return {
        title: 'Não conseguimos confirmar o resultado',
        text: 'A operação ainda pode estar em andamento ou já ter sido gravada. A ausência de recibo não confirma que nada foi gravado. Consulte novamente antes de continuar.',
      }
    case 'expired':
      return { title: 'Sessão expirada', text: 'Entre de novo para continuar.' }
  }
}

function Outcome({
  phase,
  reload,
  retry,
  verify,
}: {
  phase: RunPhase
  reload: () => void
  retry: () => void
  verify: () => void
}) {
  if (phase.kind === 'reconciling')
    return (
      <p role="status" className={styles.progress}>
        Confirmando com o servidor se a operação foi gravada…
      </p>
    )
  if (phase.kind !== 'failed') return null
  const { title, text } = failureText(phase.failure)
  return (
    <div role="alert" className={styles.alert}>
      <p className={styles.alertTitle}>{title}</p>
      <p>{text}</p>
      <div className={styles.alertActions}>
        {phase.canRetry ? <AdminButton onClick={retry}>Tentar de novo</AdminButton> : null}
        {phase.failure.kind === 'unknown' && !phase.verified ? (
          <AdminButton onClick={verify}>Verificar agora</AdminButton>
        ) : null}
        <AdminButton variant="outline" onClick={reload}>
          Atualizar
        </AdminButton>
      </div>
    </div>
  )
}

/** Diálogo de confirmação: nada é gravado antes de o administrador acionar o botão final. */
function ConfirmDialog({
  open,
  busy,
  title,
  confirmLabel,
  children,
  ready,
  onCancel,
  onConfirm,
}: {
  open: boolean
  busy: boolean
  title: string
  confirmLabel: string
  children: ReactNode
  /** Falso enquanto faltar alguma confirmação obrigatória. */
  ready: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onCancel} dismissible={!busy} titleId={titleId}>
      <h2 id={titleId} className={styles.dialogTitle}>
        {title}
      </h2>
      <div className={styles.dialogBody}>{children}</div>
      <div className={styles.dialogActions}>
        <AdminButton variant="outline" data-autofocus disabled={busy} onClick={onCancel}>
          Cancelar
        </AdminButton>
        <AdminButton pending={busy} disabled={!ready && !busy} onClick={onConfirm}>
          {busy ? 'Gravando…' : confirmLabel}
        </AdminButton>
      </div>
    </Modal>
  )
}

const busyOf = (phase: RunPhase) => phase.kind === 'submitting' || phase.kind === 'reconciling'

// ---------------------------------------------------------------------------------------------
// Sem documento: inicialização explícita
// ---------------------------------------------------------------------------------------------

export function StartPanel({ revision, reload, onApplied, onExpired }: FlowProps) {
  const [confirming, setConfirming] = useState(false)
  const { phase, run, retry, verify } = useCommandRun({
    onApplied: (receipt: CommandReceipt) =>
      onApplied(receipt.read, 'Documento da página inicial criado. Nada foi publicado.'),
    onExpired,
  })
  const busy = busyOf(phase)
  const blocked = phase.kind === 'failed' && !phase.verified

  // Uma falha fecha o diálogo e mostra o resultado no painel.
  useEffect(() => {
    if (phase.kind === 'failed') setConfirming(false)
  }, [phase.kind])

  return (
    <section className={styles.panel} aria-labelledby="init-title">
      <h2 id="init-title" className={styles.title}>
        Ainda não há documento da página inicial
      </h2>
      <p className={styles.lead}>
        O CMS não tem nenhum rascunho editorial. Você pode iniciar o primeiro documento agora. Nada
        é publicado e o site continua como está.
      </p>
      <h3 className={styles.subtitle}>O que será criado</h3>
      <ul className={styles.list}>
        <li>
          {INITIAL_SECTION_COUNT} seções com os textos que o site usa hoje: abertura, vitrine de
          barris, faixa, catálogo, como funciona, sobre, destaque, perguntas frequentes e contato.
        </li>
        <li>A vitrine de barris começa sem nenhum barril selecionado.</li>
        <li>
          O número de WhatsApp do documento fica em branco; o site continua usando o número já
          configurado.
        </li>
        <li>O documento fica como rascunho. Editar os textos ainda não é possível nesta tela.</li>
      </ul>
      <Outcome phase={phase} reload={reload} retry={retry} verify={verify} />
      <div className={styles.actions}>
        <AdminButton disabled={busy || blocked} onClick={() => setConfirming(true)}>
          Iniciar documento…
        </AdminButton>
      </div>

      <ConfirmDialog
        open={confirming}
        busy={busy}
        title="Criar o documento da página inicial?"
        confirmLabel="Criar documento"
        ready
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          void run({ action: 'startV2', revision, document: buildInitialDocument() })
        }
      >
        <p>
          Isto grava o primeiro rascunho do CMS v2 com as {INITIAL_SECTION_COUNT} seções descritas
          na tela. Só pode ser feito uma vez, enquanto não houver documento. Nada é publicado.
        </p>
      </ConfirmDialog>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Rascunho v1: prévia primeiro, confirmação específica depois
// ---------------------------------------------------------------------------------------------

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; view: ConversionView }
  | { status: 'error'; failure: Failure }

const PREVIEW_FAILURE: Partial<Record<Failure['kind'], string>> = {
  conflict: 'O documento mudou depois que você abriu esta tela. Atualize para ver o estado atual.',
  unavailable: 'O CMS v2 ainda não está disponível no servidor. Nada foi alterado.',
  forbidden: 'O servidor recusou o pedido. Nada foi alterado.',
  invalid: 'O servidor recusou o pedido da prévia. Nada foi alterado.',
}

export function ConvertPanel({ revision, reload, onApplied, onExpired }: FlowProps) {
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [confirming, setConfirming] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [acknowledged, setAcknowledged] = useState<string[]>([])
  const attempt = useRef(0)
  // `onExpired` chega como função nova a cada render: guardá-la numa ref evita recarregar a prévia.
  const expiredRef = useRef(onExpired)
  expiredRef.current = onExpired
  const { phase, run, retry, verify } = useCommandRun({
    onApplied: (receipt: CommandReceipt) =>
      onApplied(receipt.read, 'Documento convertido para o v2. Nada foi publicado.'),
    onExpired,
  })
  const busy = busyOf(phase)
  const blocked = phase.kind === 'failed' && !phase.verified

  // A prévia não escreve nada (o servidor só calcula): é a primeira coisa que se vê neste estado.
  const load = useCallback(async () => {
    const mine = ++attempt.current
    setPreview({ status: 'loading' })
    const outcome = await previewConversion(revision, crypto.randomUUID())
    if (mine !== attempt.current) return
    if (outcome.ok) return setPreview({ status: 'ready', view: describeConversion(outcome.value) })
    if (outcome.failure.kind === 'expired') return expiredRef.current()
    setPreview({ status: 'error', failure: outcome.failure })
  }, [revision])
  useEffect(() => {
    void load()
    return () => {
      attempt.current++
    }
  }, [load])

  useEffect(() => {
    if (phase.kind === 'failed') setConfirming(false)
  }, [phase.kind])

  const view = preview.status === 'ready' ? preview.view : null
  const allAcknowledged = view ? view.losses.every((loss) => acknowledged.includes(loss)) : false
  const open = () => {
    setUnderstood(false)
    setAcknowledged([])
    setConfirming(true)
  }

  return (
    <section className={styles.panel} aria-labelledby="init-title">
      <h2 id="init-title" className={styles.title}>
        O rascunho está no formato antigo (v1)
      </h2>
      <p className={styles.lead}>
        Para ver e, mais adiante, editar as seções, o documento precisa ser convertido para o v2.
        Veja primeiro o que muda. Nada é alterado até você confirmar.
      </p>

      {preview.status === 'loading' ? (
        <p role="status" className={styles.progress}>
          Calculando a prévia da conversão…
        </p>
      ) : null}

      {preview.status === 'error' ? (
        <div role="alert" className={styles.alert}>
          <p className={styles.alertTitle}>Não foi possível gerar a prévia</p>
          <p>
            {PREVIEW_FAILURE[preview.failure.kind] ??
              'Não conseguimos gerar a prévia agora. Nada foi alterado.'}
          </p>
          <div className={styles.alertActions}>
            {preview.failure.kind === 'conflict' ? null : (
              <AdminButton onClick={() => void load()}>Tentar de novo</AdminButton>
            )}
            <AdminButton variant="outline" onClick={reload}>
              Atualizar
            </AdminButton>
          </div>
        </div>
      ) : null}

      {view ? (
        <>
          <h3 className={styles.subtitle}>O que acontece na conversão</h3>
          <ul className={styles.list}>
            {view.consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {view.notices.length > 0 ? (
            <div className={styles.notices}>
              <p className={styles.noticesTitle}>Avisos da conversão</p>
              <ul>
                {view.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className={styles.losses}>
            {view.losses.length === 0
              ? 'Nenhuma perda de conteúdo foi detectada.'
              : `${view.losses.length} ${view.losses.length === 1 ? 'perda precisa' : 'perdas precisam'} ser reconhecidas na confirmação.`}
          </p>

          <h3 className={styles.subtitle}>Seções depois da conversão</h3>
          <ol className={styles.sections}>
            {view.sections.map((section) => (
              <li key={section.id} className={styles.section}>
                <span className={styles.position} aria-hidden="true">
                  {section.position}
                </span>
                <span className={styles.sectionText}>
                  <span className={styles.sectionTitle}>{section.title}</span>
                  <span className={styles.sectionMeta}>
                    {section.kind}
                    {section.wasKind ? ` · era “${section.wasKind}”` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <Outcome phase={phase} reload={reload} retry={retry} verify={verify} />
          <div className={styles.actions}>
            <AdminButton disabled={busy || blocked} onClick={open}>
              Converter para v2…
            </AdminButton>
          </div>

          <ConfirmDialog
            open={confirming}
            busy={busy}
            title="Converter para o formato v2?"
            confirmLabel="Converter agora"
            ready={understood && allAcknowledged}
            onCancel={() => setConfirming(false)}
            onConfirm={() =>
              void run({
                action: 'convertToV2',
                revision,
                acknowledge: [...acknowledged].sort(),
              })
            }
          >
            <p>
              A conversão é definitiva: depois dela, o rascunho deixa de ser salvo no formato v1. As
              versões antigas continuam guardadas. Nada é publicado.
            </p>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={understood}
                disabled={busy}
                onChange={(event) => setUnderstood(event.currentTarget.checked)}
              />
              <span>Entendo que a conversão é definitiva.</span>
            </label>
            {view.losses.map((loss) => (
              <label key={loss} className={styles.check}>
                <input
                  type="checkbox"
                  checked={acknowledged.includes(loss)}
                  disabled={busy}
                  onChange={(event) =>
                    setAcknowledged((current) =>
                      event.currentTarget.checked
                        ? [...current, loss]
                        : current.filter((item) => item !== loss),
                    )
                  }
                />
                <span>Estou ciente: {loss}</span>
              </label>
            ))}
          </ConfirmDialog>
        </>
      ) : null}
    </section>
  )
}

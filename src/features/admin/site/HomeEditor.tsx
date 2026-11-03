import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CMS_LIMITS } from '../../../../shared/cms/common'
import { deriveLayout } from '../../../../shared/cms/layout'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import { AdminButton } from '../ui/AdminButton'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Switch } from '../ui/Switch'
import type { Failure } from './cmsCommands'
import {
  addItem,
  canSave,
  checkDocument,
  countChars,
  isDirty,
  isMandatory,
  kindOf,
  limitOf,
  listLength,
  listOf,
  problemKey,
  readField,
  removeItem,
  setField,
  setVisible,
} from './editModel'
import styles from './HomeEditor.module.css'
import view from './SiteView.module.css'
import {
  describeDocument,
  describeSection,
  documentNotices,
  documentSetupPending,
  type FieldRow,
  NAVIGATION_LABEL,
  type SectionSummary,
  type SiteRead,
  STATUS_LABEL,
  summarizeSections,
} from './siteModel'
import { useCommandRun } from './useCommandRun'

type V2Read = Extract<SiteRead, { kind: 'v2' }>

/** Alterações locais guardadas só em memória quando a sessão expira no meio da edição. */
export type SiteRescue = { document: CmsDocumentV2; revision: string; userId: string }

const emptyText = (row: FieldRow) =>
  row.key.endsWith('media')
    ? 'Sem imagem'
    : row.key === 'anchor'
      ? 'Sem âncora'
      : row.key === 'whatsapp'
        ? 'Não definido'
        : 'Vazio'

/** Uma linha somente leitura (estrutura, mídia, referências de catálogo). */
function ReadOnlyRow({ row }: { row: FieldRow }) {
  return (
    <div
      className={row.group ? view.groupRow : view.row}
      data-depth={row.depth ?? 0}
      data-status={row.status}
    >
      <dt className={view.term}>
        <span>{row.label}</span>
        {row.group ? null : (
          <span className={`${view.status} ${view[row.status]}`}>{STATUS_LABEL[row.status]}</span>
        )}
      </dt>
      <dd className={view.value}>
        {row.group ? null : row.value === null ? (
          <span className={view.empty}>{emptyText(row)}</span>
        ) : (
          <span className={row.long ? view.long : undefined}>{row.value}</span>
        )}
        {row.hint ? <small className={view.hint}>{row.hint}</small> : null}
      </dd>
    </div>
  )
}

function Rows({ rows, label }: { rows: FieldRow[]; label: string }) {
  return (
    <dl className={view.rows} aria-label={label}>
      {rows.map((row) => (
        <ReadOnlyRow key={row.key} row={row} />
      ))}
    </dl>
  )
}

const metaOf = (section: SectionSummary) =>
  [
    section.title === section.templateLabel ? null : section.templateLabel,
    section.anchor ? `#${section.anchor}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

function SectionItem({
  section,
  selected,
  changed,
  problem,
  onSelect,
}: {
  section: SectionSummary
  selected: boolean
  changed: boolean
  problem: boolean
  onSelect: () => void
}) {
  const meta = metaOf(section)
  return (
    <li>
      <button
        type="button"
        className={view.item}
        aria-current={selected ? 'true' : undefined}
        data-hidden={!section.visible}
        data-changed={changed}
        onClick={onSelect}
      >
        <span className={view.position} aria-hidden="true">
          {section.position ?? '–'}
        </span>
        <span className={view.itemText}>
          <span className={view.itemTitle}>{section.title}</span>
          {meta ? <span className={view.itemMeta}>{meta}</span> : null}
        </span>
        <span className={view.itemFlags}>
          {problem ? <span className={styles.flagErr}>Precisa de ajuste</span> : null}
          {changed ? <span className={styles.flagChanged}>Alterada</span> : null}
          {section.visible ? null : <span className={view.flagWarn}>Oculta</span>}
          {section.mandatory ? <span className={view.flag}>Obrigatória</span> : null}
          {section.navigation === 'none' ? null : (
            <span className={view.flag}>{NAVIGATION_LABEL[section.navigation]}</span>
          )}
        </span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------------------------
// Campo de texto com contador e erro acessíveis
// ---------------------------------------------------------------------------------------------

function EditorField({
  fieldKey,
  label,
  value,
  long,
  limit,
  hint,
  problem,
  disabled,
  onChange,
  action,
}: {
  fieldKey: string
  label: string
  value: string
  long: boolean
  limit: number
  hint?: string
  problem?: string
  disabled: boolean
  onChange: (value: string) => void
  action?: ReactNode
}) {
  const id = useId()
  const count = countChars(value)
  const describedBy = [hint ? `${id}-hint` : null, `${id}-count`, problem ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ')
  const common = {
    id,
    name: fieldKey,
    'data-field': fieldKey,
    value,
    disabled,
    className: `${styles.input} ${long ? styles.area : ''}`,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': describedBy,
    spellCheck: true,
    lang: 'pt-BR',
  }
  return (
    <div className={styles.field} data-invalid={Boolean(problem)}>
      <div className={styles.fieldHead}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {action}
      </div>
      {long ? (
        <textarea {...common} rows={4} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          type="text"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <div className={styles.fieldFoot}>
        <span>
          {problem ? (
            <span id={`${id}-error`} className={styles.error} role="alert">
              {problem}
            </span>
          ) : null}
          {hint ? (
            <small id={`${id}-hint`} className={styles.hint}>
              {hint}
            </small>
          ) : null}
        </span>
        <small
          id={`${id}-count`}
          className={count > limit ? styles.countOver : styles.count}
          data-testid="char-count"
        >
          {count} de {limit}
        </small>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Resultado do salvamento: sempre diz se algo foi gravado e o que dá para fazer
// ---------------------------------------------------------------------------------------------

function saveFailureText(failure: Failure): { title: string; text: string } {
  const kept = 'Suas alterações continuam nesta tela.'
  switch (failure.kind) {
    case 'conflict':
      return {
        title: 'O rascunho mudou em outro lugar',
        text: `Outra sessão salvou o rascunho depois que você abriu esta tela. Nada foi gravado por esta operação. ${kept} Elas não podem ser salvas por cima da versão nova: copie o que precisar e carregue a versão atual.`,
      }
    case 'operation-conflict':
      return {
        title: 'Operação recusada',
        text: `Esta operação já tinha sido usada com outros dados. Nada foi gravado. ${kept} Faça uma alteração e salve de novo.`,
      }
    case 'invalid':
      return {
        title: 'O servidor recusou o rascunho',
        text: `Nada foi gravado. ${kept} Revise os campos${failure.code ? ` (${failure.code})` : ''} e salve de novo.`,
      }
    case 'forbidden':
      return {
        title: 'Pedido recusado pelo servidor',
        text: `O servidor não aceitou a origem do pedido. Nada foi gravado. ${kept} Recarregue a página só depois de copiar o que precisa.`,
      }
    case 'unavailable':
      return {
        title: 'O CMS v2 não está disponível',
        text: `O servidor não está pronto para salvar agora. Nada foi gravado. ${kept} Tente de novo em instantes.`,
      }
    case 'unknown':
      return {
        title: 'Não conseguimos confirmar se o rascunho foi salvo',
        text: `A conexão falhou antes da resposta. O rascunho pode ter sido gravado. ${kept} Um recibo ausente não confirma que a operação falhou. Verifique novamente ou repita manualmente a mesma operação idempotente, sem criar um pedido diferente.`,
      }
    case 'acknowledgement':
    case 'expired':
      return { title: 'Sessão expirada', text: 'Entre de novo para continuar.' }
  }
}

// ---------------------------------------------------------------------------------------------
// Editor da seção selecionada
// ---------------------------------------------------------------------------------------------

type Edit = (change: (doc: CmsDocumentV2) => CmsDocumentV2, focus?: string) => void

function SectionEditor({
  doc,
  layout,
  moduleId,
  problems,
  disabled,
  edit,
}: {
  doc: CmsDocumentV2
  layout: ReturnType<typeof deriveLayout>
  moduleId: string
  problems: Map<string, string>
  disabled: boolean
  edit: Edit
}) {
  const detail = describeSection(doc, layout, moduleId)
  const module = doc.modules.find((m) => m.id === moduleId)
  if (!detail || !module) return null
  const mandatory = isMandatory(module)
  const list = listOf(module)
  const total = listLength(module)
  const structure = detail.structure.filter((row) => row.key !== 'visible')
  const firstRowOf = (key: string) => /^(items|steps)\.\d+(\.(title|question))?$/.test(key)
  return (
    <>
      <h3 className={view.groupTitle}>Visibilidade</h3>
      <div className={styles.visibility}>
        {mandatory ? (
          <p className={styles.visibilityText}>
            <strong>Sempre visível.</strong> Esta seção é obrigatória e não pode ser ocultada.
          </p>
        ) : (
          <>
            <Switch
              checked={module.visible}
              onChange={(visible) => edit((current) => setVisible(current, moduleId, visible))}
              label={`Mostrar “${detail.title}” no site`}
              onText="Visível"
              offText="Oculta"
            />
            <p className={styles.visibilityText}>
              {module.visible
                ? 'A seção aparece na página quando o documento for publicado.'
                : 'A seção fica fora da página e do menu. O texto continua guardado no rascunho.'}
            </p>
          </>
        )}
      </div>

      <h3 className={view.groupTitle}>Estrutura</h3>
      <Rows rows={structure} label={`Estrutura de ${detail.title}`} />

      <h3 className={view.groupTitle}>Conteúdo</h3>
      <div className={styles.fields}>
        {detail.content.map((row) => {
          if (row.group)
            return (
              <div key={row.key} className={styles.listHead}>
                <p className={styles.listTitle}>{row.label}</p>
                {list && row.key === list ? (
                  <AdminButton
                    variant="outline"
                    data-add={moduleId}
                    disabled={disabled || total >= CMS_LIMITS.list}
                    onClick={() =>
                      edit(
                        (current) => addItem(current, moduleId),
                        `${problemKey(moduleId, list === 'steps' ? `steps.${total}.title` : module.template === 'faq' ? `items.${total}.question` : `items.${total}`)}`,
                      )
                    }
                  >
                    {total >= CMS_LIMITS.list ? 'Limite de itens atingido' : 'Adicionar item'}
                  </AdminButton>
                ) : null}
              </div>
            )
          if (row.status !== 'editable' || readField(module, row.key) === null)
            return (
              <dl key={row.key} className={styles.readonly}>
                <ReadOnlyRow row={row} />
              </dl>
            )
          const key = problemKey(moduleId, row.key)
          const index = Number(row.key.split('.')[1])
          return (
            <EditorField
              key={row.key}
              fieldKey={key}
              label={row.label}
              value={readField(module, row.key) ?? ''}
              long={Boolean(row.long)}
              limit={limitOf(kindOf(row.key))}
              hint={row.hint && !row.hint.startsWith('até') ? row.hint : undefined}
              problem={problems.get(key)}
              disabled={disabled}
              onChange={(value) => edit((current) => setField(current, moduleId, row.key, value))}
              action={
                list && firstRowOf(row.key) ? (
                  <AdminButton
                    variant="outline"
                    className={styles.remove}
                    disabled={disabled}
                    aria-label={`Remover ${row.label}`}
                    onClick={() =>
                      edit((current) => removeItem(current, moduleId, index), `add:${moduleId}`)
                    }
                  >
                    Remover
                  </AdminButton>
                ) : null
              }
            />
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Tela do documento: lista de seções, formulário e barra de salvamento
// ---------------------------------------------------------------------------------------------

export function HomeEditor({
  read,
  restore,
  onApplied,
  onExpired,
  onDirtyChange,
  onSnapshotChange,
  onLockChange,
  onReload,
}: {
  read: V2Read
  /** Cópia guardada em memória; revisão divergente é preservada como conflito, sem mesclar. */
  restore: SiteRescue | null
  onApplied: (read: V2Read, message: string) => void
  onExpired: (rescue: { document: CmsDocumentV2; revision: string }) => void
  onDirtyChange: (dirty: boolean) => void
  onSnapshotChange: (snapshot: Omit<SiteRescue, 'userId'> | null) => void
  onLockChange: (locked: boolean) => void
  /** Recarrega o documento do servidor; só é chamado depois de o administrador confirmar o descarte. */
  onReload: () => void
}) {
  const [doc, setDoc] = useState<CmsDocumentV2>(restore?.document ?? read.document)
  const [baseRevision, setBaseRevision] = useState(read.revision)
  const [recoveryConflict, setRecoveryConflict] = useState(
    Boolean(restore && restore.revision !== read.revision),
  )
  if (baseRevision !== read.revision) {
    setRecoveryConflict(false)
    setBaseRevision(read.revision)
    setDoc(read.document)
  }
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'discard' | 'reload' | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<string | null>(null)
  const titleId = useId()
  const statusId = useId()

  const layout = useMemo(() => deriveLayout(doc), [doc])
  const check = useMemo(() => checkDocument(doc), [doc])
  const dirty = isDirty(read.document, doc)
  const changedSections = useMemo(() => {
    const before = new Map(read.document.modules.map((m) => [m.id, JSON.stringify(m)]))
    return new Set(
      doc.modules.filter((m) => before.get(m.id) !== JSON.stringify(m)).map((m) => m.id),
    )
  }, [doc, read.document])

  const onDirty = useRef(onDirtyChange)
  onDirty.current = onDirtyChange
  useEffect(() => onDirty.current(dirty), [dirty])
  useEffect(() => () => onDirty.current(false), [])

  const resetRun = useRef<() => void>(() => {})
  const { phase, run, retry, verify, reset } = useCommandRun({
    onApplied: (receipt) => {
      resetRun.current()
      onApplied(receipt.read, 'Rascunho salvo. Nada foi publicado.')
    },
    onExpired: () =>
      onExpired({
        document: doc,
        revision: recoveryConflict ? (restore?.revision ?? read.revision) : read.revision,
      }),
  })
  resetRun.current = reset

  const busy = phase.kind === 'submitting' || phase.kind === 'reconciling'
  const failed: Failure | null =
    phase.kind === 'failed'
      ? phase.failure
      : recoveryConflict
        ? { kind: 'conflict', code: 'CMS_REVISION_CONFLICT' }
        : null
  const conflict = failed?.kind === 'conflict'
  // Desfecho incerto: não se edita nem se salva outra versão até saber se a primeira foi gravada.
  const locked = busy || failed?.kind === 'unknown'
  // Buffer volátil: sobrevive à expiração iniciada em outra tela, sem storage ou autosave.
  const lifecycle = useRef({ onSnapshotChange, onLockChange })
  lifecycle.current = { onSnapshotChange, onLockChange }
  useEffect(() => {
    lifecycle.current.onSnapshotChange(
      dirty
        ? {
            document: doc,
            revision: recoveryConflict ? (restore?.revision ?? read.revision) : read.revision,
          }
        : null,
    )
  }, [dirty, doc, read.revision, recoveryConflict, restore?.revision])
  useEffect(() => {
    lifecycle.current.onLockChange(locked)
    return () => lifecycle.current.onLockChange(false)
  }, [locked])
  const canSubmit = dirty && canSave(check) && !locked && !conflict

  const edit: Edit = (change, focus) => {
    if (locked) return
    setDoc(change)
    if (focus) focusAfter.current = focus
    if (phase.kind === 'failed' && !conflict) reset()
  }

  useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    const selector = target.startsWith('add:')
      ? `[data-add="${target.slice(4)}"]`
      : `[data-field="${target}"]`
    document.querySelector<HTMLElement>(selector)?.focus()
  })

  const sections = summarizeSections(doc, layout)
  const selected = sections.find((s) => s.id === selectedId) ?? sections[0]
  const notices = documentNotices({ ...read, document: doc, layout })
  const pending = documentSetupPending({ ...read, document: doc, layout })
  const visibleCount = sections.filter((s) => s.visible).length
  const problemCount = check.problems.size

  const select = (id: string) => {
    setSelectedId(id)
    if (window.matchMedia('(max-width: 63.99rem)').matches)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        }),
      )
  }

  const save = () => {
    if (!canSubmit) return
    void run({ action: 'saveDraft', revision: read.revision, document: doc })
  }

  // Uma falha leva o foco ao aviso: quem está no fim de um formulário longo não pode deixar de vê-lo.
  useEffect(() => {
    if (phase.kind === 'failed') alertRef.current?.focus()
  }, [phase])

  const status = busy
    ? phase.kind === 'reconciling'
      ? 'Confirmando com o servidor se o rascunho foi salvo…'
      : 'Salvando o rascunho…'
    : failed
      ? failed.kind === 'unknown'
        ? 'Não sabemos se o rascunho foi salvo. Veja o aviso acima.'
        : 'O rascunho não foi salvo. Veja o aviso acima.'
      : problemCount > 0
        ? `${problemCount === 1 ? '1 campo precisa' : `${problemCount} campos precisam`} de ajuste antes de salvar.`
        : check.documentProblem
          ? check.documentProblem
          : dirty
            ? `Alterações não salvas em ${changedSections.size} ${changedSections.size === 1 ? 'seção' : 'seções'}.`
            : 'Tudo salvo. Nenhuma alteração pendente.'

  const failure = failed ? saveFailureText(failed) : null

  return (
    <>
      <ul className={view.chips} aria-label="Resumo do documento">
        <li className={view.chip}>
          {sections.length} {sections.length === 1 ? 'seção' : 'seções'}
        </li>
        <li className={view.chip}>
          {visibleCount} {visibleCount === 1 ? 'visível' : 'visíveis'}
        </li>
        <li className={`${view.chip} ${view.chipInfo}`}>Revisão {read.revision.slice(0, 11)}…</li>
        {dirty ? (
          <li className={`${view.chip} ${styles.chipDirty}`}>Alterações não salvas</li>
        ) : null}
      </ul>

      {pending.length > 0 ? (
        <div className={view.notices} role="status">
          <p className={view.noticesTitle}>Rascunho incompleto</p>
          <ul>
            {pending.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>Essas configurações editoriais ainda estão pendentes. Nada foi publicado.</p>
        </div>
      ) : null}

      {notices.length > 0 ? (
        <div className={view.notices} role="status">
          <p className={view.noticesTitle}>Avisos do documento</p>
          <ul>
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className={view.documentInfo}>
        <summary>Documento e dados comerciais</summary>
        <Rows
          rows={describeDocument({ ...read, document: doc, layout })}
          label="Dados do documento"
        />
      </details>

      <div className={view.split}>
        <nav aria-label="Seções da página inicial" className={view.sections}>
          <ol className={view.list}>
            {sections.map((section) => (
              <SectionItem
                key={section.id}
                section={section}
                selected={section.id === selected?.id}
                changed={changedSections.has(section.id)}
                problem={check.sections.has(section.id)}
                onSelect={() => select(section.id)}
              />
            ))}
          </ol>
        </nav>

        {selected ? (
          <section ref={detailRef} className={view.detail} aria-labelledby={titleId}>
            <header className={view.detailHead}>
              <p className={view.detailKind}>
                {selected.templateLabel}
                {selected.number ? ` · seção ${selected.number}` : ''}
              </p>
              <h2 id={titleId} className={view.detailTitle}>
                {selected.title}
              </h2>
            </header>
            <fieldset className={styles.form} disabled={locked}>
              <legend className="visually-hidden">Editar {selected.title}</legend>
              <SectionEditor
                doc={doc}
                layout={layout}
                moduleId={selected.id}
                problems={check.problems}
                disabled={locked}
                edit={edit}
              />
            </fieldset>
          </section>
        ) : null}
      </div>

      {failure ? (
        <div ref={alertRef} tabIndex={-1} role="alert" className={styles.alert}>
          <p className={styles.alertTitle}>{failure.title}</p>
          <p>{failure.text}</p>
          <div className={styles.alertActions}>
            {failed?.kind === 'unavailable' ? (
              <AdminButton onClick={retry}>Tentar de novo</AdminButton>
            ) : null}
            {failed?.kind === 'unknown' ? (
              <>
                <AdminButton onClick={verify}>Verificar agora</AdminButton>
                <AdminButton variant="outline" onClick={retry}>
                  Tentar salvar de novo
                </AdminButton>
              </>
            ) : null}
            {conflict ? (
              <AdminButton variant="outline" onClick={() => setConfirm('reload')}>
                Carregar versão atual…
              </AdminButton>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.saveBar} data-dirty={dirty} data-invalid={problemCount > 0}>
        <div className={styles.saveText}>
          <p id={statusId} role="status" aria-live="polite" className={styles.saveStatus}>
            {status}
          </p>
          <p className={styles.saveNote}>
            {dirty
              ? 'A prévia ainda não mostra estas alterações: ela exibe só o último rascunho salvo.'
              : 'A prévia mostra o último rascunho salvo. Nada é publicado por esta tela.'}
          </p>
        </div>
        <div className={styles.saveActions}>
          <AdminButton
            variant="outline"
            disabled={!dirty || locked}
            onClick={() => setConfirm('discard')}
          >
            Descartar alterações
          </AdminButton>
          <AdminButton
            pending={busy}
            disabled={!canSubmit && !busy}
            aria-describedby={statusId}
            onClick={save}
          >
            {busy ? 'Salvando…' : 'Salvar rascunho'}
          </AdminButton>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'discard'}
        title="Descartar as alterações?"
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          setDoc(read.document)
          setRecoveryConflict(false)
          reset()
        }}
      >
        As alterações feitas desde o último salvamento serão perdidas. O rascunho salvo não muda.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'reload'}
        title="Carregar a versão atual?"
        confirmLabel="Descartar e carregar"
        cancelLabel="Continuar editando"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          onReload()
        }}
      >
        Suas alterações serão descartadas e a tela mostrará o rascunho que está salvo agora no
        servidor.
      </ConfirmDialog>
    </>
  )
}

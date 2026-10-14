import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { AdminButton } from '../ui/AdminButton'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Tabs } from '../ui/Tabs'
import { Toast, type ToastState } from '../ui/Toast'
import { useFlip } from '../ui/useFlip'
import styles from './CatalogView.module.css'
import { ProductRow } from './ProductRow'
import { type AdminItem, SLOTS, TAB_IDS, TAB_LABELS, type TabId } from './types'
import type { useCatalogEditor } from './useCatalogEditor'

type Editor = ReturnType<typeof useCatalogEditor>

type CatalogViewProps = { editor: Editor; toast: ToastState }

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

function SkeletonRows() {
  return (
    <div role="status" aria-label="Carregando catálogo">
      <ul className={styles.list} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((key) => (
          <li key={key} className={styles.skeleton}>
            <span className={styles.skeletonBlock} />
            <span className={styles.skeletonBlock} />
            <span className={styles.skeletonBlock} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CatalogView({ editor, toast }: CatalogViewProps) {
  const { state, errors, changed, dirty } = editor
  const [tab, setTab] = useState<TabId>('chopes')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const focusAfter = useRef<{ move?: string; field?: string } | null>(null)
  const idPrefix = useId()
  const draft = state.draft
  const saved = state.load.status === 'ready' ? state.load.saved : null
  const flip = useFlip(draft?.order[tab] ?? [])

  // Foco depois de reordenar (o botão pode estar desabilitado na borda) ou de um erro ao salvar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dispara a cada mudança do rascunho
  useEffect(() => {
    const target = focusAfter.current
    focusAfter.current = null
    if (!target) return
    if (target.field) document.querySelector<HTMLElement>(`[data-field="${target.field}"]`)?.focus()
    if (target.move) {
      const [id, direction] = target.move.split(':')
      const same = document.querySelector<HTMLElement>(
        `[data-move="${id}:${direction}"]:not(:disabled)`,
      )
      const other = document.querySelector<HTMLElement>(
        `[data-move="${id}:${Number(direction) * -1}"]:not(:disabled)`,
      )
      ;(same ?? other)?.focus()
    }
  }, [draft, tab, focusTick])

  if (state.load.status === 'loading' || !draft || !saved) {
    return (
      <div className={styles.page}>
        <div className={styles.content}>
          <Heading chopes={null} hidden={0} />
          {state.load.status === 'error' ? (
            <section className={styles.failure} aria-labelledby={`${idPrefix}-failure`}>
              <p className={styles.eyebrow}>Sem conexão com o catálogo</p>
              <h2 id={`${idPrefix}-failure`} className={styles.failureTitle}>
                Não conseguimos carregar o catálogo
              </h2>
              <p className={styles.failureText}>
                Tente de novo em instantes. O que já foi salvo no site continua como estava.
              </p>
              <div className={styles.failureActions}>
                <AdminButton onClick={editor.retry}>Tentar de novo</AdminButton>
                <a className={styles.siteLink} href="/">
                  Ver o site
                </a>
              </div>
            </section>
          ) : (
            <SkeletonRows />
          )}
        </div>
      </div>
    )
  }

  const order = draft.order[tab]
  const items = new Map<string, AdminItem>(
    [...saved.chopes, ...saved.cachacas].map((item) => [item.id, item]),
  )
  const hidden = TAB_IDS.flatMap((id) => draft.order[id]).filter((id) => !draft.visible[id]).length
  const showError = (id: string) => (slot: string) =>
    state.attempted || state.touched[`${id}:${slot}`]
  const rowErrors = (id: string) => {
    const visible = showError(id)
    const found = errors[id] ?? {}
    return Object.fromEntries(
      Object.entries(found).filter(([slot]) =>
        slot === 'row'
          ? state.attempted || SLOTS[tab].some(({ slot: s }) => state.touched[`${id}:${s}`])
          : visible(slot),
      ),
    )
  }

  const trySave = async () => {
    if (await editor.save()) return
    for (const id of TAB_IDS) {
      const bad = draft.order[id].find((itemId) => errors[itemId])
      if (!bad) continue
      const slot = Object.keys(errors[bad]).find((key) => key !== 'row') ?? SLOTS[id][0].slot
      focusAfter.current = { field: `${bad}:${slot}` }
      setTab(id)
      setFocusTick((tick) => tick + 1)
      return
    }
  }

  const move = (id: string, direction: -1 | 1) => {
    flip.snapshot()
    const name = items.get(id)?.name ?? ''
    const from = order.indexOf(id)
    setAnnouncement(`${name} movido para a posição ${from + 1 + direction} de ${order.length}.`)
    focusAfter.current = { move: `${id}:${direction}` }
    editor.move(tab, id, direction)
  }

  const labelCount = (id: TabId) => draft.order[id].length
  const unsaved = `${changed.length} ${plural(changed.length, 'produto tem', 'produtos têm')} alterações não salvas.`

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <Heading chopes={draft.order.chopes.length} hidden={hidden} />
        <Tabs
          label="Tipo de produto"
          idPrefix={idPrefix}
          active={tab}
          onChange={setTab}
          items={TAB_IDS.map((id) => ({ id, label: TAB_LABELS[id], count: labelCount(id) }))}
        >
          {order.length === 0 ? (
            <section className={styles.empty}>
              <h2 className={styles.failureTitle}>
                {tab === 'chopes' ? 'Nenhum chope ainda' : 'Nenhuma cachaça ainda'}
              </h2>
              <p className={styles.failureText}>
                Quando houver itens cadastrados, eles aparecem aqui para você editar.
              </p>
            </section>
          ) : (
            <div className={styles.table} style={{ '--slots': SLOTS[tab].length } as CSSProperties}>
              <div className={styles.head} aria-hidden="true">
                <span>Foto</span>
                <span>Produto</span>
                {SLOTS[tab].map(({ slot, label }) => (
                  <span key={slot}>{label}</span>
                ))}
                <span>No site</span>
                <span>Ordem</span>
              </div>
              <ul className={styles.list}>
                {order.map((id, index) => {
                  const item = items.get(id)
                  if (!item) return null
                  return (
                    <ProductRow
                      key={id}
                      rowRef={flip.register(id)}
                      tab={tab}
                      item={item}
                      position={index + 1}
                      total={order.length}
                      visible={draft.visible[id]}
                      text={draft.text[id]}
                      errors={rowErrors(id)}
                      changed={changed.includes(id)}
                      onPrice={(slot, text) => editor.setPrice(id, slot, text)}
                      onBlur={(slot) => editor.blurPrice(id, slot)}
                      onVisible={(visible) => editor.setVisible(id, visible)}
                      onMove={(direction) => move(id, direction)}
                    />
                  )
                })}
              </ul>
              <p className={styles.note}>
                {tab === 'chopes' ? (
                  <>
                    <span className={styles.noteLong}>
                      Deixe um preço em branco quando o produto não é vendido naquele tamanho. O
                      botão do tamanho some do site automaticamente.
                    </span>
                    <span className={styles.noteShort}>
                      Preço em branco: o tamanho não aparece no site.
                    </span>
                  </>
                ) : (
                  'O preço da garrafa é obrigatório.'
                )}
              </p>
            </div>
          )}
        </Tabs>
        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>

      <div className={styles.bar}>
        <div className={styles.toastSlot}>
          <Toast toast={toast} />
        </div>
        <div className={styles.barInner}>
          <p className={styles.message} data-dirty={dirty}>
            {state.saving
              ? 'Salvando…'
              : state.conflict
                ? 'O catálogo mudou em outra sessão. Recarregue para poder salvar.'
                : dirty
                  ? unsaved
                  : 'Tudo salvo.'}
          </p>
          <div className={styles.actions}>
            <AdminButton
              variant="outline"
              disabled={!dirty || state.saving}
              onClick={() => setDiscardOpen(true)}
            >
              Descartar
            </AdminButton>
            <AdminButton
              pending={state.saving}
              disabled={!dirty && !state.saving}
              onClick={trySave}
            >
              {state.saving ? (
                'Salvando…'
              ) : (
                <>
                  <span className={styles.long}>Salvar alterações</span>
                  <span className={styles.short}>Salvar</span>
                </>
              )}
            </AdminButton>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={discardOpen}
        title="Descartar alterações?"
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          // Em conflito o "salvo" local está desatualizado: descartar recarrega do servidor.
          if (state.conflict) editor.reload()
          else editor.discard()
          setDiscardOpen(false)
          setAnnouncement('Alterações descartadas.')
        }}
      >
        {`${changed.length} ${plural(changed.length, 'produto tem', 'produtos têm')} alterações que ainda não foram salvas. Se descartar, tudo volta ao que está no site agora.`}
      </ConfirmDialog>

      <ConfirmDialog
        open={state.conflictOpen}
        title="O catálogo mudou"
        confirmLabel="Recarregar catálogo"
        cancelLabel="Continuar editando"
        onCancel={editor.dismissConflict}
        onConfirm={editor.reload}
      >
        Outra sessão salvou alterações depois que você abriu esta página. Para não sobrescrever o
        trabalho dela, nada foi salvo. Recarregue o catálogo para ver os valores atuais; suas
        alterações ainda não salvas serão perdidas.
      </ConfirmDialog>
    </div>
  )
}

function Heading({ chopes, hidden }: { chopes: number | null; hidden: number }) {
  return (
    <div className={styles.heading}>
      <div>
        <p className={styles.eyebrow}>
          <span className={styles.eyebrowDesktop}>Catálogo</span>
          {chopes === null ? null : (
            <span className={styles.eyebrowMobile}>
              {chopes} {plural(chopes, 'produto', 'produtos')}
              {hidden > 0 ? ` · ${hidden} ${plural(hidden, 'oculto', 'ocultos')}` : ''}
            </span>
          )}
        </p>
        <h1 className={styles.title}>Produtos</h1>
      </div>
      {chopes === null ? null : (
        <ul className={styles.chips} aria-label="Resumo do catálogo">
          <li className={styles.chip}>
            {chopes} {plural(chopes, 'produto', 'produtos')}
          </li>
          {hidden > 0 ? (
            <li className={`${styles.chip} ${styles.chipGold}`}>
              {hidden} {plural(hidden, 'indisponível', 'indisponíveis')}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  )
}

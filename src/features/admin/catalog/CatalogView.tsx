import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { AdminButton } from '../ui/AdminButton'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Tabs } from '../ui/Tabs'
import { Toast, type ToastState } from '../ui/Toast'
import { useFlip } from '../ui/useFlip'
import styles from './CatalogView.module.css'
import { type DraftItem, hasContent, isStandardRow } from './draft'
import { ItemCard } from './ItemCard'
import { NewProductDialog } from './NewProductDialog'
import { ProductRow } from './ProductRow'
import { type CategoryId, EMPTY_TITLE, PRICE_REQUIRED, STANDARD_COLUMNS } from './types'
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
  const [selectedTab, setTab] = useState<CategoryId>('chopes')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [cancelKey, setCancelKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const focusAfter = useRef<{ move?: string; field?: string } | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const idPrefix = useId()
  const draft = state.draft
  const saved = state.load.status === 'ready' ? state.load.saved : null
  const categories = saved?.categories ?? []
  const tab = categories.some((c) => c.id === selectedTab) ? selectedTab : (categories[0]?.id ?? '')
  const flip = useFlip(draft?.order[tab] ?? [])

  // Foco depois de reordenar (o botão pode estar desabilitado na borda), de um erro ao salvar
  // ou de criar um produto (o foco vai ao campo Nome do cadastro novo).
  // biome-ignore lint/correctness/useExhaustiveDependencies: dispara a cada mudança do rascunho
  useEffect(() => {
    const target = focusAfter.current
    focusAfter.current = null
    if (!target) return
    if (target.field) document.querySelector<HTMLElement>(`[data-field="${target.field}"]`)?.focus()
    if (target.move) {
      const sep = target.move.lastIndexOf(':')
      const key = target.move.slice(0, sep)
      const direction = Number(target.move.slice(sep + 1))
      const same = document.querySelector<HTMLElement>(
        `[data-move="${key}:${direction}"]:not(:disabled)`,
      )
      const other = document.querySelector<HTMLElement>(
        `[data-move="${key}:${direction * -1}"]:not(:disabled)`,
      )
      ;(same ?? other)?.focus()
    }
  }, [draft, tab, focusTick])

  // Teclado virtual e foco: ao abrir/fechar o teclado a área visível muda, e um campo já "visível"
  // pode estar sob a barra fixa. Aqui o campo focado (com a margem de rolagem dos controles)
  // sempre fica acima da barra de salvamento.
  useEffect(() => {
    const reveal = () => {
      const field = document.activeElement
      if (
        field instanceof HTMLElement &&
        field.matches('input, textarea') &&
        field.closest('main') &&
        !field.closest('dialog')
      )
        field.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
    const viewport = window.visualViewport
    const onFocus = () => requestAnimationFrame(reveal)
    window.addEventListener('resize', reveal)
    viewport?.addEventListener('resize', reveal)
    document.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('resize', reveal)
      viewport?.removeEventListener('resize', reveal)
      document.removeEventListener('focusin', onFocus)
    }
  }, [])

  if (state.load.status === 'loading' || !draft || !saved) {
    return (
      <div className={styles.page}>
        <div className={styles.content}>
          <Heading chopes={null} hidden={0} onNew={() => {}} />
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

  const order = draft.order[tab] ?? []
  const allKeys = categories.flatMap((c) => draft.order[c.id] ?? [])
  const hidden = allKeys.filter((key) => !draft.items[key].visible).length
  const productsCount = (draft.order.chopes ?? allKeys).length
  const columns = STANDARD_COLUMNS[tab] ?? []
  const tableRows = order.some((key) => isStandardRow(draft.items[key]))
  const touchedAny = (key: string) =>
    Object.keys(state.touched).some((path) => path.startsWith(`${key}:`))

  /** Só o que deve aparecer agora: após visitar o campo ou depois da primeira tentativa de salvar. */
  const shownErrors = (key: string) =>
    Object.fromEntries(
      Object.entries(errors[key] ?? {}).filter(([field]) =>
        state.attempted || field === 'row' || field === 'variants'
          ? state.attempted || touchedAny(key)
          : state.touched[`${key}:${field}`] && state.edited[`${key}:${field}`],
      ),
    )

  const trySave = async () => {
    if (await editor.save()) return
    for (const category of categories) {
      const bad = (draft.order[category.id] ?? []).find((key) => errors[key])
      if (!bad) continue
      const item = draft.items[bad]
      const field =
        Object.keys(errors[bad]).find((name) => name !== 'row' && name !== 'variants') ??
        (isStandardRow(item) ? `price:${item.variants[0].key}` : 'name')
      focusAfter.current = { field: `${bad}:${field}` }
      setTab(category.id)
      setFocusTick((tick) => tick + 1)
      return
    }
  }

  const move = (key: string, direction: -1 | 1) => {
    flip.snapshot()
    const name = draft.items[key].name.trim() || 'Novo produto'
    const from = order.indexOf(key)
    setAnnouncement(`${name} movido para a posição ${from + 1 + direction} de ${order.length}.`)
    focusAfter.current = { move: `${key}:${direction}` }
    editor.move(tab, key, direction)
  }

  const create = (category: CategoryId) => {
    const key = editor.addItem(category)
    setNewOpen(false)
    setTab(category)
    pendingFocus.current = key // o foco só vai ao Nome em onClosed, depois que o modal devolve o foco
    const name = categories.find((c) => c.id === category)?.name ?? ''
    setAnnouncement(`Novo produto adicionado em ${name}. Preencha o nome e as variantes.`)
  }

  const cancel = (item: DraftItem) => {
    if (hasContent(item)) setCancelKey(item.key)
    else {
      editor.cancelItem(item.key)
      setAnnouncement('Cadastro cancelado.')
    }
  }

  const unsaved = `${changed.length} ${plural(changed.length, 'produto tem', 'produtos têm')} alterações não salvas.`
  const categoryName = (id: CategoryId) => categories.find((c) => c.id === id)?.name ?? ''

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <Heading chopes={productsCount} hidden={hidden} onNew={() => setNewOpen(true)} />
        <Tabs
          label="Tipo de produto"
          idPrefix={idPrefix}
          active={tab}
          onChange={setTab}
          items={categories.map((c) => ({
            id: c.id,
            label: c.name,
            count: (draft.order[c.id] ?? []).length,
          }))}
        >
          {order.length === 0 ? (
            <section className={styles.empty}>
              <h2 className={styles.failureTitle}>
                {EMPTY_TITLE[tab] ?? `Nenhum item em ${categoryName(tab)}`}
              </h2>
              <p className={styles.failureText}>
                Use “Novo produto” para cadastrar o primeiro. Os itens cadastrados aparecem aqui
                para você editar.
              </p>
            </section>
          ) : (
            <div
              className={styles.table}
              style={{ '--slots': Math.max(columns.length, 1) } as CSSProperties}
            >
              {tableRows ? (
                <div className={styles.head} aria-hidden="true">
                  <span>Foto</span>
                  <span>Produto</span>
                  {columns.map(({ code, label }) => (
                    <span key={code}>{label}</span>
                  ))}
                  <span>No site</span>
                  <span>Ordem</span>
                </div>
              ) : null}
              <ul className={styles.list}>
                {order.map((key, index) => {
                  const item = draft.items[key]
                  const common = {
                    item,
                    priceRequired: PRICE_REQUIRED.has(tab),
                    position: index + 1,
                    total: order.length,
                    errors: shownErrors(key),
                    changed: changed.includes(key),
                    rowRef: flip.register(key),
                    onVisible: (visible: boolean) => editor.setVisible(key, visible),
                    onMove: (direction: -1 | 1) => move(key, direction),
                  }
                  return isStandardRow(item) ? (
                    <ProductRow
                      key={key}
                      {...common}
                      columns={columns}
                      onPrice={(code, text) => editor.setVariantField(key, code, 'priceText', text)}
                      onBlur={(code) => editor.blurPrice(key, code)}
                    />
                  ) : (
                    <ItemCard
                      key={key}
                      {...common}
                      categoryName={categoryName(tab)}
                      onItemField={(field, text) => editor.setItemField(key, field, text)}
                      onTouch={(field) => editor.touch(`${key}:${field}`)}
                      onVariantField={(variant, field, text) =>
                        editor.setVariantField(key, variant, field, text)
                      }
                      onBlurPrice={(variant) => editor.blurPrice(key, variant)}
                      onAddVariant={() => {
                        const variant = editor.addVariant(key)
                        focusAfter.current = { field: `${key}:label:${variant}` }
                        setFocusTick((tick) => tick + 1)
                      }}
                      onRemoveVariant={(variant) => editor.removeVariant(key, variant)}
                      onCancel={() => cancel(item)}
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
                ) : PRICE_REQUIRED.has(tab) ? (
                  'O preço é obrigatório em cada variante.'
                ) : null}
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

      <NewProductDialog
        open={newOpen}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        initial={tab}
        onCancel={() => setNewOpen(false)}
        onCreate={create}
        onClosed={() => {
          if (!pendingFocus.current) return
          focusAfter.current = { field: `${pendingFocus.current}:name` }
          pendingFocus.current = null
          setFocusTick((tick) => tick + 1)
        }}
      />

      <ConfirmDialog
        open={cancelKey !== null}
        title="Cancelar cadastro?"
        confirmLabel="Cancelar cadastro"
        cancelLabel="Continuar editando"
        onCancel={() => setCancelKey(null)}
        onConfirm={() => {
          if (cancelKey) editor.cancelItem(cancelKey)
          setCancelKey(null)
          setAnnouncement('Cadastro cancelado.')
        }}
      >
        O que você digitou neste produto ainda não foi salvo e será descartado.
      </ConfirmDialog>

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
        {`${changed.length} ${plural(changed.length, 'produto tem', 'produtos têm')} alterações que ainda não foram salvas. Se descartar, tudo volta ao que está no site agora e os cadastros novos desaparecem.`}
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

function Heading({
  chopes,
  hidden,
  onNew,
}: {
  chopes: number | null
  hidden: number
  onNew: () => void
}) {
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
        <div className={styles.headingActions}>
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
          <AdminButton className={styles.newButton} onClick={onNew}>
            Novo produto
          </AdminButton>
        </div>
      )}
    </div>
  )
}

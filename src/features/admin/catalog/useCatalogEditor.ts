import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { buildCatalog, changedIds, type Draft, draftFrom, moveId, validate } from './draft'
import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { formatPriceText, parsePriceText } from './price'
import type { AdminCatalog, PriceSlot, TabId } from './types'

type State = {
  load: { status: 'loading' } | { status: 'error' } | { status: 'ready'; saved: AdminCatalog }
  draft: Draft | null
  /** Campos já visitados ("id:slot"): só eles mostram erro antes da primeira tentativa de salvar. */
  touched: Record<string, true>
  attempted: boolean
  saving: boolean
  /** Outra sessão salvou antes: salvar fica bloqueado até recarregar. */
  conflict: boolean
  conflictOpen: boolean
}

type Action =
  | { type: 'loading' }
  | { type: 'load-failed' }
  | { type: 'loaded'; catalog: AdminCatalog }
  | { type: 'price'; id: string; slot: PriceSlot; text: string }
  | { type: 'blur'; id: string; slot: PriceSlot }
  | { type: 'visible'; id: string; visible: boolean }
  | { type: 'move'; tab: TabId; id: string; direction: -1 | 1 }
  | { type: 'discard' }
  | { type: 'attempt' }
  | { type: 'saving' }
  | { type: 'saved'; catalog: AdminCatalog }
  | { type: 'save-failed' }
  | { type: 'conflict' }
  | { type: 'conflict-open' }
  | { type: 'conflict-close' }

const initial: State = {
  load: { status: 'loading' },
  draft: null,
  touched: {},
  attempted: false,
  saving: false,
  conflict: false,
  conflictOpen: false,
}

function reducer(state: State, action: Action): State {
  const { draft } = state
  switch (action.type) {
    case 'loading':
      return initial
    case 'load-failed':
      return { ...initial, load: { status: 'error' } }
    case 'loaded':
      return {
        ...initial,
        load: { status: 'ready', saved: action.catalog },
        draft: draftFrom(action.catalog),
      }
    case 'saved':
      return {
        ...initial,
        load: { status: 'ready', saved: action.catalog },
        draft: draftFrom(action.catalog),
      }
    case 'saving':
      return { ...state, saving: true }
    case 'save-failed':
      return { ...state, saving: false }
    case 'conflict':
      return { ...state, saving: false, conflict: true, conflictOpen: true }
    case 'conflict-open':
      return { ...state, conflictOpen: true }
    case 'conflict-close':
      return { ...state, conflictOpen: false }
    case 'attempt':
      return { ...state, attempted: true }
    case 'discard':
      return state.load.status === 'ready'
        ? { ...initial, load: state.load, draft: draftFrom(state.load.saved) }
        : state
    default:
      break
  }
  if (!draft) return state
  switch (action.type) {
    case 'price':
      return {
        ...state,
        draft: {
          ...draft,
          text: {
            ...draft.text,
            [action.id]: { ...draft.text[action.id], [action.slot]: action.text },
          },
        },
      }
    case 'blur': {
      const text = draft.text[action.id]?.[action.slot] ?? ''
      const parsed = parsePriceText(text)
      const formatted = parsed.ok ? formatPriceText(parsed.cents) : text
      return {
        ...state,
        touched: { ...state.touched, [`${action.id}:${action.slot}`]: true },
        draft: {
          ...draft,
          text: {
            ...draft.text,
            [action.id]: { ...draft.text[action.id], [action.slot]: formatted },
          },
        },
      }
    }
    case 'visible':
      return {
        ...state,
        draft: { ...draft, visible: { ...draft.visible, [action.id]: action.visible } },
      }
    case 'move':
      return {
        ...state,
        draft: {
          ...draft,
          order: {
            ...draft.order,
            [action.tab]: moveId(draft.order[action.tab], action.id, action.direction),
          },
        },
      }
    default:
      return state
  }
}

type Options = {
  onUnauthenticated: () => void
  notify: (kind: 'success' | 'error', message: string) => void
}

/** Estado do editor: carrega pelo gateway, mantém o rascunho e salva o catálogo inteiro. */
export function useCatalogEditor(
  gateway: AdminCatalogGateway,
  { onUnauthenticated, notify }: Options,
) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [attempt, retryLoad] = useReducer((value: number) => value + 1, 0)
  const latest = useRef(state)
  latest.current = state

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    if (attempt > 0) dispatch({ type: 'loading' })
    gateway
      .load(controller.signal)
      .then((catalog) => active && dispatch({ type: 'loaded', catalog }))
      .catch((error) => {
        if (!active) return
        if (error instanceof AdminApiError && error.code === 'unauthenticated') onUnauthenticated()
        else dispatch({ type: 'load-failed' })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [gateway, attempt, onUnauthenticated])

  const saved = state.load.status === 'ready' ? state.load.saved : null
  const errors = useMemo(() => (state.draft ? validate(state.draft) : {}), [state.draft])
  const changed = useMemo(
    () => (saved && state.draft ? changedIds(saved, state.draft) : []),
    [saved, state.draft],
  )

  /** `false` quando há campos inválidos: a interface mostra os erros e leva o foco até o primeiro. */
  const save = useCallback(async (): Promise<boolean> => {
    const { load, draft, saving, conflict } = latest.current
    if (load.status !== 'ready' || !draft || saving) return true
    if (conflict) {
      // Sem chamar o servidor: salvar agora sobrescreveria o trabalho da outra sessão.
      dispatch({ type: 'conflict-open' })
      return true
    }
    if (Object.keys(validate(draft)).length) {
      dispatch({ type: 'attempt' })
      notify('error', 'Corrija os campos destacados para salvar.')
      return false
    }
    dispatch({ type: 'saving' })
    try {
      const next = await gateway.save(buildCatalog(load.saved, draft))
      dispatch({ type: 'saved', catalog: next })
      notify('success', 'Salvo. As mudanças já estão no site.')
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 'conflict') {
        dispatch({ type: 'conflict' })
        return true
      }
      dispatch({ type: 'save-failed' })
      if (error instanceof AdminApiError && error.code === 'unauthenticated') onUnauthenticated()
      else
        notify('error', 'Não foi possível salvar. Suas alterações continuam aqui; tente de novo.')
    }
    return true
  }, [gateway, notify, onUnauthenticated])

  return {
    state,
    errors,
    changed,
    dirty: changed.length > 0,
    retry: retryLoad,
    /** Recarrega do servidor e descarta o rascunho (saída do conflito). */
    reload: retryLoad,
    dismissConflict: () => dispatch({ type: 'conflict-close' }),
    setPrice: (id: string, slot: PriceSlot, text: string) =>
      dispatch({ type: 'price', id, slot, text }),
    blurPrice: (id: string, slot: PriceSlot) => dispatch({ type: 'blur', id, slot }),
    setVisible: (id: string, visible: boolean) => dispatch({ type: 'visible', id, visible }),
    move: (tab: TabId, id: string, direction: -1 | 1) =>
      dispatch({ type: 'move', tab, id, direction }),
    discard: () => dispatch({ type: 'discard' }),
    save,
  }
}

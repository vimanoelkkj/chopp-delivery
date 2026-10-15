import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
  changedKeys,
  type Draft,
  type DraftItem,
  type DraftVariant,
  draftFrom,
  moveId,
  newItemDraft,
  newVariantDraft,
  validate,
} from './draft'
import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { formatPriceText, parsePriceText } from './price'
import {
  canRestore,
  performSave,
  type Rescue,
  rebaseAfterApplied,
  recoverUncertain,
} from './saveFlow'
import type { AdminCatalog, CategoryId, SaveInput } from './types'

type State = {
  load: { status: 'loading' } | { status: 'error' } | { status: 'ready'; saved: AdminCatalog }
  draft: Draft | null
  /** Campos já visitados ("itemKey:campo"): só eles mostram erro antes da primeira tentativa de salvar. */
  touched: Record<string, true>
  /** Campos que o usuário já alterou: erro de campo vazio só aparece depois de editar e sair, ou ao salvar. */
  edited: Record<string, true>
  attempted: boolean
  saving: boolean
  /** Outra sessão salvou antes: salvar fica bloqueado até recarregar. */
  conflict: boolean
  conflictOpen: boolean
  /** PUT de resultado incerto (resposta perdida): salvar de novo só depois de reconciliar. */
  uncertain: SaveInput | null
  recovering: boolean
}

export type ItemField = 'name' | 'description'
export type VariantField = 'label' | 'volumeText' | 'priceText'

type Action =
  | { type: 'loading' }
  | { type: 'load-failed' }
  | { type: 'loaded'; catalog: AdminCatalog }
  | { type: 'item-field'; key: string; field: ItemField; text: string }
  | { type: 'variant-field'; key: string; variant: string; field: VariantField; text: string }
  | { type: 'touch'; path: string }
  | { type: 'blur-price'; key: string; variant: string }
  | { type: 'visible'; key: string; visible: boolean }
  | { type: 'move'; category: CategoryId; key: string; direction: -1 | 1 }
  | { type: 'add-item'; item: DraftItem }
  | { type: 'cancel-item'; key: string }
  | { type: 'add-variant'; key: string; variant: DraftVariant }
  | { type: 'remove-variant'; key: string; variant: string }
  | { type: 'discard' }
  | { type: 'attempt' }
  | { type: 'saving' }
  | { type: 'saved'; catalog: AdminCatalog }
  | { type: 'save-failed' }
  | { type: 'conflict' }
  | { type: 'conflict-open' }
  | { type: 'conflict-close' }
  | { type: 'uncertain'; input: SaveInput }
  | { type: 'recovering'; value: boolean }
  | { type: 'clear-uncertain' }
  | { type: 'restore'; catalog: AdminCatalog; draft: Draft }

const VARIANT_PATH: Record<VariantField, string> = {
  label: 'label',
  volumeText: 'volume',
  priceText: 'price',
}

export type EditorState = State
export type EditorAction = Action

export const initial: State = {
  load: { status: 'loading' },
  draft: null,
  touched: {},
  edited: {},
  attempted: false,
  saving: false,
  conflict: false,
  conflictOpen: false,
  uncertain: null,
  recovering: false,
}

const withItem = (draft: Draft, key: string, change: (item: DraftItem) => DraftItem): Draft =>
  draft.items[key]
    ? { ...draft, items: { ...draft.items, [key]: change(draft.items[key]) } }
    : draft

const withVariant = (item: DraftItem, key: string, change: (v: DraftVariant) => DraftVariant) => ({
  ...item,
  variants: item.variants.map((variant) => (variant.key === key ? change(variant) : variant)),
})

export function reducer(state: State, action: Action): State {
  const { draft } = state
  switch (action.type) {
    case 'loading':
      return initial
    case 'load-failed':
      return { ...initial, load: { status: 'error' } }
    case 'loaded':
    case 'saved':
      return {
        ...initial,
        load: { status: 'ready', saved: action.catalog },
        draft: draftFrom(action.catalog),
      }
    case 'restore':
      return {
        ...initial,
        load: { status: 'ready', saved: action.catalog },
        draft: action.draft,
      }
    case 'uncertain':
      return { ...state, saving: false, uncertain: action.input }
    case 'recovering':
      return { ...state, recovering: action.value, saving: action.value }
    case 'clear-uncertain':
      return { ...state, uncertain: null }
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
      // Itens ainda não persistidos somem junto: o rascunho volta ao snapshot salvo.
      return state.load.status === 'ready'
        ? { ...initial, load: state.load, draft: draftFrom(state.load.saved) }
        : state
    default:
      break
  }
  if (!draft) return state
  switch (action.type) {
    case 'item-field':
      return {
        ...state,
        edited: { ...state.edited, [`${action.key}:${action.field}`]: true },
        draft: withItem(draft, action.key, (item) => ({ ...item, [action.field]: action.text })),
      }
    case 'variant-field':
      return {
        ...state,
        edited: {
          ...state.edited,
          [`${action.key}:${VARIANT_PATH[action.field]}:${action.variant}`]: true,
        },
        draft: withItem(draft, action.key, (item) =>
          withVariant(item, action.variant, (variant) => ({
            ...variant,
            [action.field]: action.text,
          })),
        ),
      }
    case 'touch':
      return { ...state, touched: { ...state.touched, [action.path]: true } }
    case 'blur-price': {
      const item = draft.items[action.key]
      const variant = item?.variants.find((v) => v.key === action.variant)
      if (!variant) return state
      const parsed = parsePriceText(variant.priceText)
      const formatted = parsed.ok ? formatPriceText(parsed.cents) : variant.priceText
      return {
        ...state,
        touched: { ...state.touched, [`${action.key}:price:${action.variant}`]: true },
        draft: withItem(draft, action.key, (it) =>
          withVariant(it, action.variant, (v) => ({ ...v, priceText: formatted })),
        ),
      }
    }
    case 'visible':
      return {
        ...state,
        draft: withItem(draft, action.key, (item) => ({ ...item, visible: action.visible })),
      }
    case 'move':
      return {
        ...state,
        draft: {
          ...draft,
          order: {
            ...draft.order,
            [action.category]: moveId(draft.order[action.category], action.key, action.direction),
          },
        },
      }
    case 'add-item':
      return {
        ...state,
        draft: {
          order: {
            ...draft.order,
            [action.item.categoryId]: [
              ...(draft.order[action.item.categoryId] ?? []),
              action.item.key,
            ],
          },
          items: { ...draft.items, [action.item.key]: action.item },
        },
      }
    case 'cancel-item': {
      const item = draft.items[action.key]
      if (!item || item.id !== null) return state // só linhas ainda temporárias saem do rascunho
      const { [action.key]: _removed, ...items } = draft.items
      return {
        ...state,
        draft: {
          items,
          order: {
            ...draft.order,
            [item.categoryId]: draft.order[item.categoryId].filter((k) => k !== action.key),
          },
        },
      }
    }
    case 'add-variant':
      return {
        ...state,
        draft: withItem(draft, action.key, (item) => ({
          ...item,
          variants: [...item.variants, action.variant],
        })),
      }
    case 'remove-variant':
      return {
        ...state,
        draft: withItem(draft, action.key, (item) => ({
          ...item,
          // Variantes persistidas nunca saem por omissão; só as temporárias podem ser removidas.
          variants: item.variants.filter((v) => v.key !== action.variant || v.code !== null),
        })),
      }
    default:
      return state
  }
}

type Options = {
  /** `rescue` só vem se havia alterações pendentes: o shell o guarda em memória e o devolve após novo login. */
  onUnauthenticated: (rescue?: Rescue) => void
  notify: (kind: 'success' | 'error', message: string) => void
  /** Rascunho guardado na expiração da sessão anterior (memória da aba; some ao recarregar). */
  rescue?: Rescue | null
  onRescueHandled?: () => void
  /** Identidade administrativa desta sessão: só ela pode receber um rascunho guardado. */
  userId: string
}

/** Estado do editor: carrega pelo gateway, mantém o rascunho e salva o catálogo inteiro. */
export function useCatalogEditor(
  gateway: AdminCatalogGateway,
  { onUnauthenticated, notify, rescue, onRescueHandled, userId }: Options,
) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [attempt, retryLoad] = useReducer((value: number) => value + 1, 0)
  const latest = useRef(state)
  latest.current = state
  const rescueRef = useRef(rescue)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    if (attempt > 0) dispatch({ type: 'loading' })
    gateway
      .load(controller.signal)
      .then((catalog) => {
        if (!active) return
        const pending = rescueRef.current
        rescueRef.current = null // consumido uma única vez, restaurado ou descartado com aviso
        if (pending) {
          onRescueHandled?.()
          if (canRestore(pending, catalog, userId)) {
            dispatch({ type: 'restore', catalog, draft: pending.draft })
            notify('success', 'Suas alterações não salvas foram restauradas.')
            return
          }
          notify(
            'error',
            pending.userId === userId
              ? 'O catálogo mudou enquanto você estava fora; as alterações não salvas da sessão anterior foram descartadas.'
              : 'As alterações não salvas pertenciam a outro usuário e foram descartadas.',
          )
        }
        dispatch({ type: 'loaded', catalog })
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof AdminApiError && error.code === 'unauthenticated') onUnauthenticated()
        else dispatch({ type: 'load-failed' })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [gateway, attempt, onUnauthenticated, notify, onRescueHandled, userId])

  const saved = state.load.status === 'ready' ? state.load.saved : null
  const errors = useMemo(() => (state.draft ? validate(state.draft) : {}), [state.draft])
  const changed = useMemo(
    () => (saved && state.draft ? changedKeys(saved, state.draft) : []),
    [saved, state.draft],
  )

  /** Sessão encerrada no meio da edição: entrega o rascunho para ser restaurado após o login. */
  const expire = useCallback(() => {
    const { load, draft } = latest.current
    const dirty = load.status === 'ready' && draft && changedKeys(load.saved, draft).length > 0
    onUnauthenticated(
      dirty && draft && load.status === 'ready'
        ? { draft, revision: load.saved.revision, userId }
        : undefined,
    )
  }, [onUnauthenticated, userId])

  /**
   * Reconcilia um PUT incerto lendo o servidor (GET). Devolve `true` se já se pode tentar salvar
   * de novo (nada foi gravado), `false` se terminou aqui (gravado, conflito ou sem resposta).
   */
  const reconcile = useCallback(
    async (input: SaveInput): Promise<boolean> => {
      dispatch({ type: 'recovering', value: true })
      const outcome = await recoverUncertain(gateway, input)
      dispatch({ type: 'recovering', value: false })
      if (outcome.kind === 'unauthenticated') {
        expire()
        return false
      }
      if (outcome.kind === 'unreachable') {
        notify(
          'error',
          'Ainda não conseguimos confirmar o último salvamento. Verifique a conexão e tente de novo.',
        )
        return false
      }
      if (outcome.kind === 'applied') {
        const { load, draft } = latest.current
        // Se o usuário editou depois da tentativa, essas edições seguem sobre o novo catálogo.
        const rebased =
          load.status === 'ready' && draft
            ? rebaseAfterApplied(input, load.saved, draft, outcome.snapshot)
            : null
        dispatch(
          rebased
            ? { type: 'restore', catalog: outcome.snapshot, draft: rebased }
            : { type: 'saved', catalog: outcome.snapshot },
        )
        notify('success', 'Confirmado: o salvamento anterior foi gravado.')
        return false
      }
      if (outcome.kind === 'conflict') {
        dispatch({ type: 'clear-uncertain' })
        dispatch({ type: 'conflict' })
        return false
      }
      dispatch({ type: 'clear-uncertain' }) // nada gravado: mesmo pedido (mesmos clientIds) é seguro
      return true
    },
    [gateway, notify, expire],
  )

  /** `false` quando há campos inválidos: a interface mostra os erros e leva o foco até o primeiro. */
  const save = useCallback(async (): Promise<boolean> => {
    const { load, draft, saving, conflict, uncertain } = latest.current
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
    if (uncertain && !(await reconcile(uncertain))) return true
    dispatch({ type: 'saving' })
    const outcome = await performSave(gateway, load.saved, draft)
    switch (outcome.kind) {
      case 'saved':
        // Reconciliação: o snapshot devolvido traz ids/codes definitivos e creationRef; o rascunho
        // é reconstruído dele e as chaves estáveis (clientId) preservam as linhas na tela.
        dispatch({ type: 'saved', catalog: outcome.result.catalog })
        notify('success', 'Salvo. As mudanças já estão no site.')
        break
      case 'conflict':
        dispatch({ type: 'conflict' })
        break
      case 'unauthenticated':
        dispatch({ type: 'save-failed' })
        expire()
        break
      case 'rejected':
        dispatch({ type: 'save-failed' })
        notify('error', 'O servidor recusou o salvamento. Revise os dados e tente de novo.')
        break
      case 'uncertain':
        dispatch({ type: 'uncertain', input: outcome.input })
        notify('error', 'Não conseguimos confirmar se o salvamento foi gravado. Verificando…')
        if (await reconcile(outcome.input))
          notify('error', 'Nada foi gravado. Suas alterações continuam aqui; tente de novo.')
        break
      default:
        break
    }
    return true
  }, [gateway, notify, reconcile, expire])

  return {
    state,
    errors,
    changed,
    dirty: changed.length > 0,
    retry: retryLoad,
    /** Recarrega do servidor e descarta o rascunho (saída do conflito). */
    reload: retryLoad,
    dismissConflict: () => dispatch({ type: 'conflict-close' }),
    setItemField: (key: string, field: ItemField, text: string) =>
      dispatch({ type: 'item-field', key, field, text }),
    setVariantField: (key: string, variant: string, field: VariantField, text: string) =>
      dispatch({ type: 'variant-field', key, variant, field, text }),
    touch: (path: string) => dispatch({ type: 'touch', path }),
    blurPrice: (key: string, variant: string) => dispatch({ type: 'blur-price', key, variant }),
    setVisible: (key: string, visible: boolean) => dispatch({ type: 'visible', key, visible }),
    move: (category: CategoryId, key: string, direction: -1 | 1) =>
      dispatch({ type: 'move', category, key, direction }),
    /** Cria o item temporário (clientId estável) no fim da categoria e devolve sua chave. */
    addItem: (category: CategoryId) => {
      const item = newItemDraft(category)
      dispatch({ type: 'add-item', item })
      return item.key
    },
    cancelItem: (key: string) => dispatch({ type: 'cancel-item', key }),
    addVariant: (key: string) => {
      const variant = newVariantDraft()
      dispatch({ type: 'add-variant', key, variant })
      return variant.key
    },
    removeVariant: (key: string, variant: string) =>
      dispatch({ type: 'remove-variant', key, variant }),
    discard: () => dispatch({ type: 'discard' }),
    save,
  }
}

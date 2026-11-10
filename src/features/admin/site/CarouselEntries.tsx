import { useEffect, useId, useRef, useState } from 'react'
import { CMS_LIMITS } from '../../../../shared/cms/common'
import type { CmsCarouselEntry } from '../../../../shared/cms/v2'
import { AdminApiError } from '../catalog/gateway'
import type { AdminCatalog } from '../catalog/types'
import { AdminButton } from '../ui/AdminButton'
import { useCatalogGateway } from './CatalogGatewayContext'
import { type changeCarousel, eligibleBarrels, entryAltKey } from './carouselModel'
import { problemKey } from './editModel'
import styles from './HomeEditor.module.css'
import { MediaSlot } from './media/MediaSlot'

type CatalogState = { status: 'loading' | 'error' } | { status: 'ready'; catalog: AdminCatalog }

/** Identidade do espaço de imagem de uma entrada: sempre pelo itemId, nunca pela posição. */
export const entrySlotId = (moduleId: string, itemId: string) => `${moduleId}:${itemId}`

export function CarouselEntries({
  moduleId,
  entries,
  problems,
  disabled,
  onChange,
  onExpired,
  onPickMedia,
  onClearMedia,
  onAltChange,
}: {
  moduleId: string
  entries: CmsCarouselEntry[]
  problems: Map<string, string>
  disabled: boolean
  onChange: (action: Parameters<typeof changeCarousel>[2]) => void
  onExpired: () => void
  onPickMedia: (itemId: string, name: string) => void
  onClearMedia: (itemId: string) => void
  onAltChange: (itemId: string, alt: string) => void
}) {
  const gateway = useCatalogGateway()
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState('')
  const select = useRef<HTMLSelectElement>(null)
  const expired = useRef(onExpired)
  expired.current = onExpired
  const id = useId()
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    if (attempt > 0) setState({ status: 'loading' })
    gateway
      .load(controller.signal)
      .then((catalog) => {
        if (active) setState({ status: 'ready', catalog })
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof AdminApiError && error.code === 'unauthenticated') expired.current()
        else setState({ status: 'error' })
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt, gateway])
  const items = state.status === 'ready' ? eligibleBarrels(state.catalog) : []
  const choices = items.filter((item) => !entries.some((entry) => entry.itemId === item.id))
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        Barris do catálogo
      </label>
      <p>
        Selecione produtos visíveis de chopes. Preços e tamanhos continuam no catálogo. Salve o
        rascunho para conferir a ordem na prévia.
      </p>
      {state.status === 'loading' ? <p role="status">Carregando barris do catálogo…</p> : null}
      {state.status === 'error' ? (
        <p role="alert">
          Não foi possível carregar o catálogo. Sua seleção foi preservada; novas entradas estão
          desativadas.
        </p>
      ) : null}
      {state.status === 'ready' && items.length === 0 ? (
        <p role="status">Nenhum produto visível de chopes disponível para selecionar.</p>
      ) : null}
      <select
        ref={select}
        id={id}
        className={styles.input}
        value={selected}
        disabled={
          disabled ||
          state.status !== 'ready' ||
          !choices.length ||
          entries.length >= CMS_LIMITS.list
        }
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">Escolha um barril</option>
        {choices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <div className={styles.saveActions}>
        <AdminButton
          variant="outline"
          disabled={
            disabled ||
            state.status !== 'ready' ||
            !choices.some((item) => item.id === selected) ||
            entries.length >= CMS_LIMITS.list
          }
          onClick={() => {
            if (state.status !== 'ready') return
            onChange({ kind: 'add', itemId: selected, catalog: state.catalog })
            setSelected('')
            select.current?.focus()
          }}
        >
          Adicionar barril
        </AdminButton>
        <AdminButton
          variant="outline"
          disabled={disabled || state.status === 'loading'}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {state.status === 'error' ? 'Tentar carregar catálogo novamente' : 'Atualizar catálogo'}
        </AdminButton>
      </div>
      <p role="status" aria-live="polite">
        {entries.length} de {CMS_LIMITS.list} barris selecionados.
      </p>
      <ol aria-label="Barris selecionados">
        {entries.map((entry, index) => {
          const item = items.find((item) => item.id === entry.itemId)
          const name = item?.name ?? entry.itemId
          return (
            <li key={entry.itemId}>
              <p>
                {name}
                {state.status === 'ready' && !item
                  ? ' — referência não elegível; remova ou confira o catálogo.'
                  : ''}
              </p>
              <div className={styles.saveActions}>
                <AdminButton
                  variant="outline"
                  aria-label={`Subir ${name}`}
                  disabled={disabled || index === 0}
                  onClick={() => onChange({ kind: 'move', itemId: entry.itemId, direction: -1 })}
                >
                  Subir
                </AdminButton>
                <AdminButton
                  variant="outline"
                  aria-label={`Descer ${name}`}
                  disabled={disabled || index === entries.length - 1}
                  onClick={() => onChange({ kind: 'move', itemId: entry.itemId, direction: 1 })}
                >
                  Descer
                </AdminButton>
                <AdminButton
                  variant="outline"
                  aria-label={`Remover ${name}`}
                  disabled={disabled}
                  onClick={() => {
                    onChange({ kind: 'remove', itemId: entry.itemId })
                    select.current?.focus()
                  }}
                >
                  Remover
                </AdminButton>
              </div>
              <MediaSlot
                moduleId={entrySlotId(moduleId, entry.itemId)}
                template="highlight"
                title={`Imagem de ${name}`}
                subject={name}
                emptyText="Sem imagem editorial. A vitrine usa a foto atual deste barril."
                media={entry.media}
                altFieldKey={problemKey(moduleId, entryAltKey(entry.itemId))}
                problem={problems.get(problemKey(moduleId, entryAltKey(entry.itemId)))}
                disabled={disabled}
                onChoose={() => onPickMedia(entry.itemId, name)}
                onClear={() => onClearMedia(entry.itemId)}
                onAltChange={(alt) => onAltChange(entry.itemId, alt)}
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

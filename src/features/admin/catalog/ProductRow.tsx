import type { Ref } from 'react'
import { Switch } from '../ui/Switch'
import { PriceField } from './PriceField'
import styles from './ProductRow.module.css'
import { type AdminItem, type PriceSlot, SLOTS, type TabId } from './types'

type ProductRowProps = {
  tab: TabId
  item: AdminItem
  position: number
  total: number
  visible: boolean
  text: Partial<Record<PriceSlot, string>>
  /** Mensagens já filtradas: só o que deve aparecer agora. */
  errors: Partial<Record<PriceSlot | 'row', string>>
  changed: boolean
  rowRef: Ref<HTMLLIElement>
  onPrice: (slot: PriceSlot, text: string) => void
  onBlur: (slot: PriceSlot) => void
  onVisible: (visible: boolean) => void
  onMove: (direction: -1 | 1) => void
}

export function ProductRow({
  tab,
  item,
  position,
  total,
  visible,
  text,
  errors,
  changed,
  rowRef,
  onPrice,
  onBlur,
  onVisible,
  onMove,
}: ProductRowProps) {
  const slots = SLOTS[tab]
  return (
    <li ref={rowRef} className={styles.row} data-visible={visible} data-changed={changed}>
      <div className={styles.photo} aria-hidden="true">
        Foto
      </div>
      <div className={styles.name}>
        <h2 className={styles.title}>{item.name}</h2>
        {changed ? <span className="visually-hidden">Alterado, ainda não salvo.</span> : null}
        <p className={styles.description}>{item.description}</p>
      </div>
      <div className={styles.prices}>
        {slots.map(({ slot, label }) => (
          <PriceField
            key={slot}
            label={label}
            ariaLabel={`${label.replace(' (R$)', '')}, preço em reais, ${item.name}`}
            fieldKey={`${item.id}:${slot}`}
            value={text[slot] ?? ''}
            error={errors[slot]}
            onChange={(value) => onPrice(slot, value)}
            onBlur={() => onBlur(slot)}
          />
        ))}
      </div>
      <div className={styles.visible}>
        <Switch
          checked={visible}
          onChange={onVisible}
          label={`${item.name} visível no site`}
          onText="Visível"
          offText="Oculto"
        />
      </div>
      <div className={styles.order}>
        <span className={styles.position}>
          Posição {position} de {total}
        </span>
        <div className={styles.moves}>
          <button
            type="button"
            className={styles.move}
            data-move={`${item.id}:-1`}
            disabled={position === 1}
            aria-label={`Subir ${item.name}`}
            onClick={() => onMove(-1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 14 6-6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.move}
            data-move={`${item.id}:1`}
            disabled={position === total}
            aria-label={`Descer ${item.name}`}
            onClick={() => onMove(1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 10 6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>
      {errors.row ? <p className={styles.rowError}>{errors.row}</p> : null}
    </li>
  )
}

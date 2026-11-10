import type { Ref } from 'react'
import { Switch } from '../ui/Switch'
import type { DraftItem } from './draft'
import { PriceField } from './PriceField'
import styles from './ProductRow.module.css'

type ProductRowProps = {
  item: DraftItem
  /** Colunas padrão da categoria (ex.: 30 L / 50 L). */
  columns: readonly { code: string; label: string }[]
  /** Preço obrigatório (cachaça): muda o placeholder do campo vazio. */
  priceRequired: boolean
  position: number
  total: number
  /** Mensagens já filtradas: só o que deve aparecer agora (`price:<code>` e `row`). */
  errors: Record<string, string>
  changed: boolean
  /** Preço salvo por coluna (texto já formatado), para mostrar "antes" nos campos alterados. */
  savedPrices?: Record<string, string>
  /** Id do texto de ajuda de como digitar preços. */
  priceHelpId?: string
  rowRef: Ref<HTMLLIElement>
  onPrice: (code: string, text: string) => void
  onBlur: (code: string) => void
  onVisible: (visible: boolean) => void
  onMove: (direction: -1 | 1) => void
  /** Abre o cartão do produto com uma variante nova (a linha só cobre as colunas padrão). */
  onAddVariant?: () => void
  /** Salvamento em andamento ou não confirmado: estrutura bloqueada. */
  identityLocked?: boolean
}

export function ProductRow({
  item,
  columns,
  priceRequired,
  position,
  total,
  errors,
  changed,
  savedPrices,
  priceHelpId,
  rowRef,
  onPrice,
  onBlur,
  onVisible,
  onMove,
  onAddVariant,
  identityLocked = false,
}: ProductRowProps) {
  const visible = item.visible
  return (
    <li ref={rowRef} className={styles.row} data-visible={visible} data-changed={changed}>
      <div className={styles.name}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{item.name}</h2>
          {changed ? (
            <span className={styles.changedTag} aria-hidden="true">
              Alterado
            </span>
          ) : null}
        </div>
        {changed ? <span className="visually-hidden">Alterado, ainda não salvo.</span> : null}
        <p className={styles.description}>{item.description}</p>
      </div>
      <div className={styles.prices}>
        {columns.map(({ code, label }) => {
          const current = item.variants.find((v) => v.code === code)?.priceText ?? ''
          const before = savedPrices?.[code]
          return (
            <PriceField
              key={code}
              label={label}
              ariaLabel={`${label.replace(' (R$)', '')}, preço em reais, ${item.name}`}
              fieldKey={`${item.key}:price:${code}`}
              value={current}
              was={before !== undefined && before !== current ? before : undefined}
              describedBy={priceHelpId}
              placeholder={priceRequired ? '0,00' : 'não vende'}
              error={errors[`price:${code}`]}
              onChange={(value) => onPrice(code, value)}
              onBlur={() => onBlur(code)}
            />
          )
        })}
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
            data-move={`${item.key}:-1`}
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
            data-move={`${item.key}:1`}
            disabled={position === total}
            aria-label={`Descer ${item.name}`}
            onClick={() => onMove(1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 10 6 6 6-6" />
            </svg>
          </button>
          {onAddVariant ? (
            <button
              type="button"
              className={styles.move}
              disabled={identityLocked}
              aria-label={`Adicionar variante a ${item.name}`}
              title="Adicionar variante"
              onClick={onAddVariant}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 6v12M6 12h12" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      {errors.row ? <p className={styles.rowError}>{errors.row}</p> : null}
    </li>
  )
}

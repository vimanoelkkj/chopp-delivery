import { MAX_ORDER_QUANTITY, MIN_ORDER_QUANTITY, normalizeQuantity } from '@/shared/lib/quantity'
import styles from './QuantityStepper.module.css'

type QuantityStepperProps = {
  value: number
  onChange: (next: number) => void
  /** Item descrito para leitores de tela (ex.: "Brahma, barril de 30L"). */
  subject: string
  /** Total já formatado; omitido quando o preço não está disponível. */
  total?: string | null
  className?: string
}

/** Seletor `− / quantidade / +` (mínimo 1). Não é campo livre: só botões, sem valores inválidos. */
export function QuantityStepper({
  value,
  onChange,
  subject,
  total,
  className,
}: QuantityStepperProps) {
  const quantity = normalizeQuantity(value)

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <fieldset className={styles.stepper} aria-label={`Quantidade de ${subject}`}>
        <button
          type="button"
          className={styles.btn}
          disabled={quantity <= MIN_ORDER_QUANTITY}
          aria-label={`Diminuir quantidade de ${subject}`}
          onClick={() => onChange(normalizeQuantity(quantity - 1))}
        >
          <span aria-hidden="true">−</span>
        </button>
        <output className={styles.value}>
          <span className="visually-hidden">Quantidade: </span>
          <span className={styles.caption} aria-hidden="true">
            Qtd.
          </span>
          {quantity}
        </output>
        <button
          type="button"
          className={styles.btn}
          disabled={quantity >= MAX_ORDER_QUANTITY}
          aria-label={`Aumentar quantidade de ${subject}`}
          onClick={() => onChange(normalizeQuantity(quantity + 1))}
        >
          <span aria-hidden="true">+</span>
        </button>
      </fieldset>
      {total ? (
        <output className={styles.total}>
          <span className={styles.totalLabel}>Total</span>
          <strong>{total}</strong>
        </output>
      ) : null}
    </div>
  )
}

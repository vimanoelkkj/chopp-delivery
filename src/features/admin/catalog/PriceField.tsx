import { useId } from 'react'
import styles from './PriceField.module.css'

type PriceFieldProps = {
  /** Texto curto da coluna, ex.: "30 L (R$)". Aparece como rótulo só no celular. */
  label: string
  /** Nome acessível completo, ex.: "30 L, preço em reais, Dronken". */
  ariaLabel: string
  value: string
  error?: string
  /** Identifica o campo para levar o foco até ele depois de uma tentativa de salvar. */
  fieldKey: string
  onChange: (text: string) => void
  onBlur: () => void
}

export function PriceField({
  label,
  ariaLabel,
  value,
  error,
  fieldKey,
  onChange,
  onBlur,
}: PriceFieldProps) {
  const errorId = useId()
  return (
    <div className={styles.field}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <input
        className={styles.input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder="não vende"
        value={value}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        name={fieldKey}
        data-field={fieldKey}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

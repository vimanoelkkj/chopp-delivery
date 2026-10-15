import { useId } from 'react'
import styles from './TextField.module.css'

type TextFieldProps = {
  /** Rótulo visível, ligado ao campo por `for`. */
  disabled?: boolean
  label: string
  value: string
  onChange: (text: string) => void
  onBlur?: () => void
  error?: string
  /** Texto de ajuda fixo abaixo do campo (ligado por aria-describedby). */
  hint?: string
  multiline?: boolean
  inputMode?: 'text' | 'numeric' | 'decimal'
  placeholder?: string
  /** Identifica o campo para levar o foco até ele (`data-field`). */
  fieldKey: string
  className?: string
}

/** Campo de texto do painel (mesmo desenho dos campos de preço): rótulo, erro e ajuda acessíveis. */
export function TextField({
  disabled,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  multiline,
  inputMode,
  placeholder,
  fieldKey,
  className,
}: TextFieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const common = {
    disabled,
    id,
    className: `${styles.input} ${multiline ? styles.area : ''}`,
    value,
    placeholder,
    name: fieldKey,
    'data-field': fieldKey,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || hint ? messageId : undefined,
    onBlur,
  }
  return (
    <div className={`${styles.field} ${className ?? ''}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error || hint ? (
        <p id={messageId} className={error ? styles.error : styles.hint}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  )
}

import { type ReactNode, useId } from 'react'
import { countChars } from './editModel'
import styles from './HomeEditor.module.css'

/** Campo de texto do editor, com contador de caracteres e erro acessíveis (rótulo, descrição e aviso ligados). */
export function EditorField({
  fieldKey,
  label,
  value,
  long,
  limit,
  hint,
  problem,
  disabled,
  onChange,
  action,
}: {
  fieldKey: string
  label: string
  value: string
  long: boolean
  limit: number
  hint?: string
  problem?: string
  disabled: boolean
  onChange: (value: string) => void
  action?: ReactNode
}) {
  const id = useId()
  const count = countChars(value)
  const describedBy = [hint ? `${id}-hint` : null, `${id}-count`, problem ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ')
  const common = {
    id,
    name: fieldKey,
    'data-field': fieldKey,
    value,
    disabled,
    className: `${styles.input} ${long ? styles.area : ''}`,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': describedBy,
    spellCheck: true,
    lang: 'pt-BR',
  }
  return (
    <div className={styles.field} data-invalid={Boolean(problem)}>
      <div className={styles.fieldHead}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {action}
      </div>
      {long ? (
        <textarea {...common} rows={4} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          type="text"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <div className={styles.fieldFoot}>
        <span>
          {problem ? (
            <span id={`${id}-error`} className={styles.error} role="alert">
              {problem}
            </span>
          ) : null}
          {hint ? (
            <small id={`${id}-hint`} className={styles.hint}>
              {hint}
            </small>
          ) : null}
        </span>
        <small
          id={`${id}-count`}
          className={count > limit ? styles.countOver : styles.count}
          data-testid="char-count"
        >
          {count} de {limit}
        </small>
      </div>
    </div>
  )
}

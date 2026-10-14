import { type ClipboardEvent, type FormEvent, useId, useRef, useState } from 'react'
import styles from './PriceField.module.css'
import { maskPriceInput, parsePastedPrice } from './price'

type PriceFieldProps = {
  /** Texto curto da coluna, ex.: "30 L (R$)". Aparece como rótulo só no celular. */
  label: string
  /** Nome acessível completo, ex.: "30 L, preço em reais, Dronken". */
  ariaLabel: string
  /** Texto já mascarado ("1.250,50") ou vazio. O estado canônico (centavos) é derivado dele. */
  value: string
  error?: string
  /** Texto do campo vazio: "não vende" nos barris; a cachaça exige preço. */
  placeholder: string
  /** Identifica o campo para levar o foco até ele depois de uma tentativa de salvar. */
  fieldKey: string
  onChange: (text: string) => void
  onBlur: () => void
}

/**
 * Campo monetário com máscara brasileira. Digita-se em centavos, da direita para a esquerda
 * ("4" → "0,04"). Toda edição (teclado físico, virtual/IME, recortar, soltar texto) chega por
 * `change` e é recalculada a partir dos dígitos; o cursor vai ao fim depois de cada edição (a seleção feita ao focar, por Tab ou por script, não é desfeita). Colar passa por
 * um parser estrito que recusa o ambíguo.
 */
export function PriceField({
  label,
  ariaLabel,
  value,
  error,
  placeholder,
  fieldKey,
  onChange,
  onBlur,
}: PriceFieldProps) {
  const errorId = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [pasteError, setPasteError] = useState<string>()
  const message = pasteError ?? error

  const caretAtEnd = () =>
    requestAnimationFrame(() => {
      const input = ref.current
      if (input && document.activeElement === input)
        input.setSelectionRange(input.value.length, input.value.length)
    })

  const edit = (event: FormEvent<HTMLInputElement>) => {
    setPasteError(undefined)
    onChange(maskPriceInput(event.currentTarget.value, value))
    caretAtEnd()
  }

  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault() // o valor colado substitui o campo inteiro, qualquer que seja a seleção
    const text = event.clipboardData.getData('text')
    if (!text.trim()) return
    const result = parsePastedPrice(text)
    if (result.ok) {
      setPasteError(undefined)
      onChange(maskPriceInput(String(result.cents), value))
      caretAtEnd()
    } else setPasteError(result.message)
  }

  return (
    <div className={styles.field}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <input
        ref={ref}
        className={styles.input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        aria-label={ariaLabel}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? errorId : undefined}
        name={fieldKey}
        data-field={fieldKey}
        onChange={edit}
        onPaste={paste}
        onBlur={() => {
          setPasteError(undefined)
          onBlur()
        }}
      />
      {message ? (
        <p id={errorId} className={styles.error} role={pasteError ? 'alert' : undefined}>
          {message}
        </p>
      ) : null}
    </div>
  )
}

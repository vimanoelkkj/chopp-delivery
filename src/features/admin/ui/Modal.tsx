import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './Modal.module.css'
import { lockScroll } from './scrollLock'

export const MODAL_MS = 180

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type ModalProps = {
  open: boolean
  /** Chamado por Esc, clique fora e pelo fechamento nativo. Em ação destrutiva = opção segura. */
  onClose: () => void
  /** Falso em ação destrutiva: Esc e clique fora não fecham. */
  dismissible?: boolean
  titleId: string
  children: ReactNode
}

/**
 * Janela modal sobre <dialog>: o navegador cuida do foco preso, do restante da página inerte
 * e da devolução do foco. Aqui entram a animação (opacity/transform), a folha inferior no
 * celular e a regra de Esc. Foco inicial: o elemento com `data-autofocus`, senão o primeiro.
 */
export function Modal({ open, onClose, dismissible = true, titleId, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const timer = setTimeout(
      () => {
        ref.current?.close() // devolve o foco ao elemento que abriu o modal
        setMounted(false)
        setClosing(false)
      },
      prefersReducedMotion() ? 0 : MODAL_MS,
    )
    return () => clearTimeout(timer)
  }, [open, mounted])

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!mounted || !dialog || dialog.open) return
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [mounted])

  useEffect(() => {
    if (mounted) return lockScroll()
  }, [mounted])

  if (!mounted) return null
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-state={open ? 'open' : 'closing'}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (dismissible && open) onClose()
      }}
      onClose={() => {
        // Fechamento nativo que não veio daqui (ex.: Esc repetido) conta como dispensar.
        if (open && !closing) onClose()
      }}
      onKeyDown={(event) => {
        // Foco preso: Tab e Shift+Tab dão a volta dentro da janela em vez de sair para o navegador.
        if (event.key !== 'Tab') return
        const focusable = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ]
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
      onClick={(event) => {
        if (dismissible && open && event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.panel}>{children}</div>
    </dialog>
  )
}

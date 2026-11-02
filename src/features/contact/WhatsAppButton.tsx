import { type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react'
import { buildWhatsAppUrl } from '@/shared/lib/whatsapp'
import { Button, type ButtonProps } from '@/shared/ui/Button'
import { CommercialPreviewContext } from './CommercialPreviewContext'
import { contact } from './config'
import { type MessageKey, messages } from './messages'
import styles from './WhatsAppButton.module.css'

type WhatsAppButtonProps = {
  message?: MessageKey
  customText?: string
  variant?: 'gold' | 'outline' | 'dark'
  size?: 'md' | 'lg'
  fullWidth?: boolean
  /** Onde o aviso de "número não configurado" aparece em relação ao botão. */
  noticePlacement?: 'below' | 'above'
  className?: string
  children: ReactNode
}

const NOTICE_MS = 5000

/**
 * Botão de WhatsApp. Com número configurado, é um link para a conversa.
 * Sem número, não finge abrir nada: mostra um aviso honesto ao ser acionado.
 */
export function WhatsAppButton({
  message = 'order',
  customText,
  noticePlacement = 'below',
  className,
  children,
  ...style
}: WhatsAppButtonProps) {
  const preview = useContext(CommercialPreviewContext)
  const text = customText ?? messages[message]
  const url = buildWhatsAppUrl(contact.whatsappNumber, text)
  const noticeId = useId()
  const [showNotice, setShowNotice] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (preview)
    return (
      <Button
        {...style}
        className={className}
        disabled
        aria-disabled="true"
        title="Ação comercial desativada na prévia"
      >
        {children}
      </Button>
    )
  if (url) {
    const linkProps: ButtonProps = {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      children,
      ...style,
      className,
    }
    return <Button {...linkProps} />
  }

  const reveal = () => {
    setShowNotice(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShowNotice(false), NOTICE_MS)
  }

  return (
    <span className={[styles.wrap, style.fullWidth ? styles.full : ''].filter(Boolean).join(' ')}>
      <Button {...style} className={className} onClick={reveal} aria-describedby={noticeId}>
        {children}
      </Button>
      <span
        id={noticeId}
        role="status"
        className={[styles.notice, noticePlacement === 'above' ? styles.above : styles.below]
          .filter(Boolean)
          .join(' ')}
      >
        {showNotice
          ? 'O número do WhatsApp ainda não foi configurado (versão de demonstração).'
          : ''}
      </span>
    </span>
  )
}

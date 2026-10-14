import { useId } from 'react'
import { AdminButton } from './AdminButton'
import styles from './ConfirmDialog.module.css'
import { Modal } from './Modal'

type ConfirmDialogProps = {
  open: boolean
  title: string
  children: string
  /** Ação destrutiva (ex.: descartar). */
  confirmLabel: string
  /** Opção segura, em destaque e com o foco inicial. */
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** Confirmação de ação destrutiva: o botão dourado é o seguro e Esc não fecha. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onCancel} dismissible={false} titleId={titleId}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <p className={styles.text}>{children}</p>
      <div className={styles.actions}>
        <AdminButton variant="cream" onClick={onConfirm}>
          {confirmLabel}
        </AdminButton>
        <AdminButton data-autofocus onClick={onCancel}>
          {cancelLabel}
        </AdminButton>
      </div>
    </Modal>
  )
}

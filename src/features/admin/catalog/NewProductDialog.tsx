import { useId, useState } from 'react'
import { AdminButton } from '../ui/AdminButton'
import { Modal } from '../ui/Modal'
import styles from './NewProductDialog.module.css'
import type { CategoryId } from './types'

type NewProductDialogProps = {
  open: boolean
  categories: { id: CategoryId; name: string }[]
  /** Categoria da aba ativa: vem marcada. */
  initial: CategoryId
  onCancel: () => void
  onCreate: (category: CategoryId) => void
  /** Depois do fechamento completo (o foco do navegador já voltou ao botão). */
  onClosed: () => void
}

/** Escolha da categoria (entre as existentes) antes de abrir o cadastro no rascunho. */
export function NewProductDialog({
  open,
  categories,
  initial,
  onCancel,
  onCreate,
  onClosed,
}: NewProductDialogProps) {
  const titleId = useId()
  const [choice, setChoice] = useState<CategoryId | null>(null)
  const selected = choice ?? initial
  return (
    <Modal open={open} onClose={onCancel} titleId={titleId} onClosed={onClosed}>
      <p className={styles.eyebrow}>Cadastro</p>
      <h2 id={titleId} className={styles.title}>
        Novo produto
      </h2>
      <p className={styles.text}>
        Escolha a categoria. O produto começa oculto. Para aparecer no site, ele precisa estar salvo
        e marcado como visível.
      </p>
      <div role="radiogroup" aria-label="Categoria" className={styles.options}>
        {categories.map((category) => (
          <label
            key={category.id}
            className={styles.option}
            data-checked={selected === category.id}
          >
            <input
              type="radio"
              name="categoria"
              value={category.id}
              checked={selected === category.id}
              data-autofocus={selected === category.id ? '' : undefined}
              onChange={() => setChoice(category.id)}
            />
            <span>{category.name}</span>
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <AdminButton variant="outline" onClick={onCancel}>
          Cancelar
        </AdminButton>
        <AdminButton
          onClick={() => {
            setChoice(null)
            onCreate(selected)
          }}
        >
          Adicionar ao rascunho
        </AdminButton>
      </div>
    </Modal>
  )
}

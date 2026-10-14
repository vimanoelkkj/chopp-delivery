import { useId, useState } from 'react'
import styles from './Faq.module.css'
import type { FaqItem } from './faq-items'

type FaqProps = {
  items: FaqItem[]
}

/** Acordeão com um item aberto por vez. Cada pergunta é um botão alcançável por teclado. */
export function Faq({ items }: FaqProps) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null)
  const baseId = useId()

  return (
    <div className={styles.list}>
      {items.map((item) => {
        const open = item.id === openId
        const buttonId = `${baseId}-${item.id}-button`
        const panelId = `${baseId}-${item.id}-panel`
        return (
          <div key={item.id} className={styles.item}>
            <h3 className={styles.heading}>
              <button
                type="button"
                id={buttonId}
                className={styles.trigger}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <span>{item.question}</span>
                <span className={styles.sign} aria-hidden="true">
                  {open ? '−' : '+'}
                </span>
              </button>
            </h3>
            <section id={panelId} aria-labelledby={buttonId} hidden={!open}>
              <p className={styles.answer}>{item.answer}</p>
            </section>
          </div>
        )
      })}
    </div>
  )
}

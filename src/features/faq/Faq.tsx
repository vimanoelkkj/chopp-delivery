import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import styles from './Faq.module.css'
import type { FaqItem } from './faq-items'

type FaqProps = {
  items: FaqItem[]
}

/** Acordeão com um item aberto por vez. Cada pergunta é um botão alcançável por teclado. */
export function Faq({ items }: FaqProps) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null)
  const baseId = useId()
  const triggers = useRef(new Map<string, HTMLButtonElement>())

  // O primeiro item nasce aberto. Ao abrir outra pergunta, a resposta aberta fecha ACIMA do botão
  // clicado e a página abaixo dela sobe de uma vez (a altura inteira da resposta). O scroll
  // anchoring do navegador ancora acima da região que encolhe, então a janela não acompanha e o
  // botão clicado foge do ponteiro. Medimos o botão antes da troca e, com a troca já aplicada ao
  // DOM, rolamos exatamente o quanto ele andou: a pergunta clicada fica parada e só a resposta muda.
  function toggle(id: string, open: boolean) {
    const trigger = triggers.current.get(id)
    const before = trigger?.getBoundingClientRect().top
    flushSync(() => setOpenId(open ? null : id))
    if (!trigger || before === undefined) return
    const moved = trigger.getBoundingClientRect().top - before
    // `instant` ignora o `scroll-behavior: smooth` global: a correção não pode ser animada.
    if (Math.abs(moved) >= 1) window.scrollBy({ top: moved, left: 0, behavior: 'instant' })
  }

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
                ref={(node) => {
                  if (node) triggers.current.set(item.id, node)
                  else triggers.current.delete(item.id)
                }}
                className={styles.trigger}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(item.id, open)}
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

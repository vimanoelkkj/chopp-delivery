import { type RefObject, useEffect, useState } from 'react'

/** Considera os pedidos realmente visíveis, inclusive após carregar o catálogo ou o editorial. */
export function useVisibleOrderCta(ref: RefObject<HTMLElement | null>, headerHeight: number) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const root = ref.current
    if (!root || typeof IntersectionObserver === 'undefined') {
      setVisible(false)
      return
    }
    const targets = new Map<Element, boolean>()
    const update = () => {
      const visibleTarget = [...targets].find(([, inView]) => inView)?.[0]
      // Se o usuário estava no flutuante, mantém o foco em um pedido visível ao ocultá-lo.
      if (visibleTarget && root.ownerDocument.activeElement?.closest('#whatsapp-flutuante'))
        (visibleTarget as HTMLElement).focus({ preventScroll: true })
      setVisible(Boolean(visibleTarget))
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (targets.has(entry.target)) targets.set(entry.target, entry.isIntersecting)
        update()
      },
      { rootMargin: `-${headerHeight}px 0px 0px 0px` },
    )
    const sync = () => {
      let added = false
      const current = new Set(root.querySelectorAll('a[href^="https://wa.me/"]'))
      for (const target of targets.keys()) {
        if (!current.has(target)) {
          observer.unobserve(target)
          targets.delete(target)
        }
      }
      for (const target of current) {
        if (!targets.has(target)) {
          targets.set(target, false)
          observer.observe(target)
          added = true
        }
      }
      if (!added) update()
    }
    sync()
    const mutations = new MutationObserver(sync)
    mutations.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [ref, headerHeight])

  return visible
}

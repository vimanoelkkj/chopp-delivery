import { type RefObject, useEffect, useState } from 'react'

/**
 * Informa se o elemento está, ao menos em parte, na área visível da tela.
 * Começa como `true` para o conteúdo que depende dele não piscar antes da primeira medição.
 * Sem IntersectionObserver, responde `false`: quem usa o resultado cai no comportamento seguro.
 */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(false)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return inView
}

import { useCallback, useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from './Modal'

/**
 * Animação FLIP para reordenação: `snapshot()` antes de mudar a ordem; depois do render,
 * cada linha que mudou de lugar desliza do ponto antigo ao novo (só transform).
 */
export function useFlip(order: readonly string[]) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const before = useRef<Map<string, number> | null>(null)

  const register = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      if (node) nodes.current.set(id, node)
      else nodes.current.delete(id)
    },
    [],
  )

  const snapshot = useCallback(() => {
    before.current = new Map(
      [...nodes.current].map(([id, node]) => [id, node.getBoundingClientRect().top]),
    )
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: roda quando a ordem muda
  useLayoutEffect(() => {
    const previous = before.current
    before.current = null
    if (!previous || prefersReducedMotion()) return
    for (const [id, node] of nodes.current) {
      const delta = (previous.get(id) ?? 0) - node.getBoundingClientRect().top
      if (delta)
        node.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
          duration: 240,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        })
    }
  }, [order])

  return { register, snapshot }
}

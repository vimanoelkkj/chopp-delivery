let locks = 0
let restore: (() => void) | undefined

/**
 * Trava a rolagem do documento enquanto há modal, sem deslocar o layout.
 *
 * - Trava no `body` e não no `html`: o `overflow` do body vai para a viewport, e o `body`
 *   continua sem virar contêiner de rolagem (com `html { overflow: hidden }` o
 *   `overflow-x: hidden` do body o transformava em um, e a barra fixa `sticky` saía da tela).
 * - Durante a trava, o html precisa ter overflow visible: clip impede que o overflow do body
 *   se propague à viewport. O valor inline original do html também é restaurado ao fechar.
 * - Compensa a barra de rolagem que some: com barra clássica (Windows) o conteúdo centrado
 *   andaria metade da largura dela. O padding é medido na hora (0 com barra sobreposta, no
 *   celular) e somado ao padding que o `html` já tiver, sem duplicar.
 * - Contado: modais sobrepostos travam uma vez só e só o último a fechar destrava.
 *   A posição de rolagem não é tocada: `overflow: hidden` a preserva.
 */
export function lockScroll(): () => void {
  if (locks++ === 0) {
    const { documentElement: html, body } = document
    const scrollbar = window.innerWidth - html.clientWidth
    const previous = {
      overflow: body.style.overflow,
      htmlOverflowX: html.style.overflowX,
      htmlOverflowY: html.style.overflowY,
      paddingRight: html.style.paddingRight,
    }
    html.style.overflowX = 'visible'
    html.style.overflowY = 'visible'
    if (scrollbar > 0) {
      const own = Number.parseFloat(getComputedStyle(html).paddingRight) || 0
      html.style.paddingRight = `${own + scrollbar}px`
    }
    body.style.overflow = 'hidden'
    restore = () => {
      body.style.overflow = previous.overflow
      html.style.overflowX = previous.htmlOverflowX
      html.style.overflowY = previous.htmlOverflowY
      html.style.paddingRight = previous.paddingRight
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--locks === 0) restore?.()
  }
}

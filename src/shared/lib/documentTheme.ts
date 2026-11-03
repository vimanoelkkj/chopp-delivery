import { useLayoutEffect } from 'react'

/** Tema da vitrine pública. Só as páginas que o ativam ganham o fundo creme no documento. */
export const PASTEL_THEME = 'pastel'

type ThemeRoot = { dataset: Record<string, string | undefined> }

const stacks = new WeakMap<object, string[]>()

/**
 * Marca `data-theme` no elemento raiz e devolve a função que desfaz a marcação.
 *
 * É uma pilha: se a tela nova montar antes de a antiga desmontar (ou a ordem inverter), o tema
 * visível é sempre o do último que continua ativo, e sem nenhum o atributo some. Assim o painel
 * administrativo, que nunca ativa o tema, volta ao fundo escuro global depois de qualquer troca.
 */
export function applyDocumentTheme(root: ThemeRoot, theme: string): () => void {
  const stack = stacks.get(root) ?? []
  stacks.set(root, stack)
  stack.push(theme)
  root.dataset.theme = theme

  let released = false
  return () => {
    if (released) return
    released = true
    const index = stack.lastIndexOf(theme)
    if (index >= 0) stack.splice(index, 1)
    const current = stack[stack.length - 1]
    if (current) root.dataset.theme = current
    else delete root.dataset.theme
  }
}

/**
 * Ativa o tema no `<html>` enquanto o componente estiver montado. Layout effect para o fundo
 * já estar certo no primeiro quadro; a limpeza roda também na troca de tela e no StrictMode.
 */
export function useDocumentTheme(theme: string) {
  useLayoutEffect(() => applyDocumentTheme(document.documentElement, theme), [theme])
}

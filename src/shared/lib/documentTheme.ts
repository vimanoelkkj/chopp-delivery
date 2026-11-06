import { useLayoutEffect } from 'react'
import { DEFAULT_THEME_MODES, type ThemeMode } from './theme'

/** Tema da vitrine pública. Só as páginas que o ativam ganham o fundo creme no documento. */
export const PASTEL_THEME = 'pastel'

/** Tema do painel administrativo: fundo claro do documento (overscroll) só nas telas do painel. */
export const ADMIN_THEME = 'admin'

type ThemeRoot = { dataset: Record<string, string | undefined> }

type Entry = { theme: string; mode: ThemeMode }
const stacks = new WeakMap<object, Entry[]>()

function show(root: ThemeRoot, entry?: Entry) {
  if (!entry) {
    delete root.dataset.theme
    delete root.dataset.themeSurface
    delete root.dataset.colorMode
    return
  }
  root.dataset.theme = entry.theme
  root.dataset.colorMode = entry.mode
  if (entry.theme === PASTEL_THEME || entry.theme === ADMIN_THEME)
    root.dataset.themeSurface = entry.theme === ADMIN_THEME ? 'admin' : 'storefront'
  else delete root.dataset.themeSurface
}

const defaultMode = (theme: string) =>
  DEFAULT_THEME_MODES[theme === ADMIN_THEME ? 'admin' : 'storefront']

/**
 * Marca `data-theme` no elemento raiz e devolve a função que desfaz a marcação.
 *
 * É uma pilha: se a tela nova montar antes de a antiga desmontar (ou a ordem inverter), o tema
 * visível é sempre o do último que continua ativo. Sem nenhum, as marcações são removidas.
 */
export function applyDocumentTheme(
  root: ThemeRoot,
  theme: string,
  mode = defaultMode(theme),
): () => void {
  const stack = stacks.get(root) ?? []
  stacks.set(root, stack)
  const entry = { theme, mode }
  stack.push(entry)
  show(root, entry)

  let released = false
  return () => {
    if (released) return
    released = true
    const index = stack.indexOf(entry)
    if (index >= 0) stack.splice(index, 1)
    const current = stack[stack.length - 1]
    show(root, current)
  }
}

/**
 * Ativa o tema no `<html>` enquanto o componente estiver montado. Layout effect para o fundo
 * já estar certo no primeiro quadro; a limpeza roda também na troca de tela e no StrictMode.
 */
export function useDocumentTheme(theme: string, mode = defaultMode(theme)) {
  useLayoutEffect(() => applyDocumentTheme(document.documentElement, theme, mode), [theme, mode])
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToastState } from './Toast'

const SUCCESS_MS = 3000
const ERROR_MS = 6000

/** Um aviso por vez. Sucesso some em 3 s, como no PDF; erro fica mais, para dar tempo de ler. */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const counter = useRef(0)

  const notify = useCallback((kind: 'success' | 'error', message: string) => {
    clearTimeout(timer.current)
    counter.current += 1
    setToast({ id: counter.current, kind, message })
    timer.current = setTimeout(() => setToast(null), kind === 'success' ? SUCCESS_MS : ERROR_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { toast, notify }
}

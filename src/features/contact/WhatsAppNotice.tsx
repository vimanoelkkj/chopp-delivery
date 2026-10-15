import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

const NOTICE_MS = 5000

const Announce = createContext<((message: string) => void) | null>(null)

/** Anúncio ao leitor de tela, se houver um provider acima; senão `null` (cada botão se vira). */
export const useWhatsAppAnnouncer = () => useContext(Announce)

/**
 * UMA região viva por página para o aviso "número não configurado". Sem isto, cada botão de
 * WhatsApp (dezenas, na vitrine) montava a sua própria região `role="status"` vazia.
 * A região fica sempre montada: um leitor de tela só anuncia mudança de texto em região que já existia.
 */
export function WhatsAppNoticeProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState('')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const announce = useCallback((message: string) => {
    setText(message)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setText(''), NOTICE_MS)
  }, [])
  return (
    <Announce.Provider value={announce}>
      {children}
      <div role="status" className="visually-hidden">
        {text}
      </div>
    </Announce.Provider>
  )
}

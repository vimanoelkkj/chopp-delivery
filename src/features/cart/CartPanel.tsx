import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CommercialPreviewContext } from '@/features/contact/CommercialPreviewContext'
import { contact } from '@/features/contact/config'
import { WhatsAppNumberContext } from '@/features/contact/WhatsAppNumberContext'
import { formatCents } from '@/shared/lib/quantity'
import { buildWhatsAppUrl } from '@/shared/lib/whatsapp'
import { QuantityStepper } from '@/shared/ui/QuantityStepper'
import type { PublicCatalog } from '../../../shared/catalog'
import { fetchExpandedCatalog } from '../catalog/expanded-api'
import { useCart } from './CartContext'
import styles from './CartPanel.module.css'
import { type CartLine, cartSignature, lineKey, lineSubtotalCents } from './cart'
import { buildCartMessage } from './message'
import { reconcileCart } from './reconcile'

/** Uma conferência vale por este tempo; depois, o envio é bloqueado até nova conferência. */
const FRESH_MS = 60_000

/** Resultado de uma busca do catálogo, atrelado ao conteúdo exato do pedido conferido. */
type Check =
  | { status: 'checking' | 'error' }
  | { status: 'done'; catalog: PublicCatalog; signature: string; at: number }

/** Devolve o foco a um elemento válido quando o que abriu o painel não existe mais (ex.: FAB). */
function restoreFocus(opener: HTMLElement | null) {
  if (opener?.isConnected) return opener.focus()
  const target = document.getElementById('chopes') ?? document.getElementById('conteudo')
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: false })
}

export function CartPanel() {
  const cart = useCart()
  const preview = useContext(CommercialPreviewContext)
  const published = useContext(WhatsAppNumberContext)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [check, setCheck] = useState<Check>({ status: 'checking' })
  const requestRef = useRef(0)
  const lastDone = useRef<Extract<Check, { status: 'done' }> | null>(null)
  const linesRef = useRef<CartLine[]>([])
  const lines = cart?.lines ?? []
  linesRef.current = lines
  const signature = cartSignature(lines)
  const closePanel = cart?.closePanel

  const revalidate = useCallback(async () => {
    const id = ++requestRef.current
    const checked = cartSignature(linesRef.current)
    setCheck({ status: 'checking' })
    try {
      const fresh = await fetchExpandedCatalog(AbortSignal.timeout(10_000))
      if (id === requestRef.current)
        setCheck({ status: 'done', catalog: fresh.expanded, signature: checked, at: Date.now() })
    } catch {
      if (id === requestRef.current) setCheck({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    void revalidate()
    return () => {
      requestRef.current++ // descarta respostas em andamento
      dialog.close?.()
      restoreFocus(opener)
    }
  }, [revalidate])

  const done = check.status === 'done' ? check : null
  if (done) lastDone.current = done
  const checkedAt = done?.at
  const checkedSignature = done?.signature

  // Qualquer mudança no pedido invalida a conferência anterior e dispara uma nova.
  useEffect(() => {
    if (checkedSignature !== undefined && checkedSignature !== signature) void revalidate()
  }, [checkedSignature, signature, revalidate])

  // Conferência expira: revalida no prazo (e ao voltar para a aba, onde timers podem atrasar).
  useEffect(() => {
    if (checkedAt === undefined) return
    const timer = window.setTimeout(
      () => void revalidate(),
      Math.max(0, checkedAt + FRESH_MS - Date.now()),
    )
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - checkedAt >= FRESH_MS)
        void revalidate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [checkedAt, revalidate])

  if (!cart) return null
  const { totalCents } = cart
  // O catálogo conferido é aplicado ao pedido ATUAL: quantidades editadas nunca voltam ao snapshot.
  // Durante uma nova conferência, os avisos seguem visíveis (catálogo da última conferência).
  const known = lastDone.current
  const current = known ? reconcileCart(lines, known.catalog) : null
  const hasIssues = current !== null && !current.clean
  const valid = done !== null && done.signature === signature && Date.now() - done.at < FRESH_MS
  const sendable = valid && current?.clean === true && lines.length > 0 && !preview
  // A mensagem usa só linhas conferidas contra o catálogo mais recente.
  const url =
    sendable && current
      ? buildWhatsAppUrl(published ?? contact.whatsappNumber, buildCartMessage(current.lines))
      : null
  const noNumber = !preview && !(published ?? contact.whatsappNumber)

  const applyUpdate = () => {
    if (current) cart.replace(current.lines)
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: clique no fundo é atalho de mouse; teclado fecha com Escape e botão Fechar
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="meu-pedido-titulo"
      data-testid="cart-panel"
      onCancel={(event) => {
        event.preventDefault()
        closePanel?.()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closePanel?.()
      }}
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <h2 id="meu-pedido-titulo" className={styles.title}>
            Meu pedido
          </h2>
          <button type="button" className={styles.close} onClick={closePanel} aria-label="Fechar">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className={styles.body}>
          {lines.length === 0 ? (
            <p className={styles.empty}>Seu pedido está vazio.</p>
          ) : (
            <ul className={styles.list}>
              {lines.map((line) => {
                const key = lineKey(line)
                const subject = `${line.name}, ${line.label}`
                return (
                  <li key={key} className={styles.line}>
                    <div className={styles.info}>
                      <span className={styles.name}>{line.name}</span>
                      <span className={styles.unit}>
                        {line.label} · {formatCents(line.unitPriceCents, true)} cada
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => cart.remove(key)}
                      aria-label={`Remover ${subject} do pedido`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <QuantityStepper
                      value={line.quantity}
                      onChange={(q) => cart.setQuantity(key, q)}
                      subject={subject}
                    />
                    <span className={styles.subtotal}>
                      <span className="visually-hidden">Subtotal </span>
                      {formatCents(lineSubtotalCents(line), true)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <p className={styles.status} role="status">
            {check.status === 'checking' ? 'Conferindo preços e disponibilidade…' : ''}
          </p>
          {check.status === 'error' ? (
            <div role="alert" className={styles.notice}>
              <p>Não foi possível conferir preços e disponibilidade agora.</p>
              <button type="button" className={styles.secondary} onClick={() => void revalidate()}>
                Conferir novamente
              </button>
            </div>
          ) : null}
          {hasIssues && current ? (
            <div role="alert" className={styles.notice}>
              <p>O catálogo mudou desde que você adicionou estes itens:</p>
              <ul>
                {current.issues.removed.map((line) => (
                  <li key={lineKey(line)}>
                    {line.name} ({line.label}) não está mais disponível e será removido.
                  </li>
                ))}
                {current.issues.changed.map((c) => (
                  <li key={lineKey(c.line)}>
                    {c.line.name} ({c.line.label}): preço de {formatCents(c.fromCents, true)} para{' '}
                    {formatCents(c.toCents, true)}.
                  </li>
                ))}
              </ul>
              <button type="button" className={styles.primary} onClick={applyUpdate}>
                Atualizar pedido
              </button>
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <p className={styles.totalRow}>
            <span className={styles.totalLabel}>Total estimado</span>
            <strong className={styles.totalValue} data-testid="cart-total">
              {formatCents(totalCents, true)}
            </strong>
          </p>
          <p className={styles.freight}>Frete a confirmar pelo WhatsApp.</p>
          {noNumber ? (
            <p className={styles.hint} role="status">
              O número do WhatsApp ainda não foi configurado (versão de demonstração).
            </p>
          ) : null}
          {url ? (
            <a className={styles.primary} href={url} target="_blank" rel="noopener noreferrer">
              Enviar pedido pelo WhatsApp
            </a>
          ) : (
            <button type="button" className={styles.primary} disabled>
              Enviar pedido pelo WhatsApp
            </button>
          )}
          <button type="button" className={styles.link} onClick={closePanel}>
            Continuar comprando
          </button>
          {lines.length > 0 ? (
            <button type="button" className={styles.linkMuted} onClick={cart.clear}>
              Limpar pedido
            </button>
          ) : null}
        </footer>
      </div>
    </dialog>
  )
}

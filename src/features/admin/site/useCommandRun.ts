import { useCallback, useRef, useState } from 'react'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import { type Failure, fetchReceipt, runCommand } from './cmsCommands'
import type { CommandReceipt } from './siteModel'

export type RunArgs =
  | { action: 'startV2'; revision: string; document: CmsDocumentV2 }
  | { action: 'convertToV2'; revision: string; acknowledge: string[] }

export type RunPhase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  /** O desfecho era incerto: a tela está perguntando ao servidor se a operação foi gravada. */
  | { kind: 'reconciling' }
  | {
      kind: 'failed'
      failure: Failure
      /** Falha definitiva deste pedido; ausência de recibo (404) nunca confirma ausência de gravação. */
      verified: boolean
      /** Tentar de novo (a mesma operação) é seguro. */
      canRetry: boolean
    }

/**
 * Executa um comando de escrita do CMS (`startV2` ou `convertToV2`) com as garantias da E6.0:
 * - nada roda ao montar: só `run`, chamado por um clique de confirmação;
 * - o `operationId` nasce no `run` e só é reutilizado para o MESMO comando (mesma ação, revisão,
 *   reconhecimentos e documento). O servidor repete esse comando de forma idempotente, então
 *   reenviar é seguro; já um `operationId` com dados diferentes seria recusado (409);
 * - nunca há reenvio automático: se o desfecho for incerto (rede, tempo esgotado, 5xx), primeiro
 *   pergunta ao servidor por `GET /commands/:id`; só um clique do administrador reenvia;
 * - uma operação por vez: cliques repetidos enquanto uma está em andamento são ignorados.
 */
export function useCommandRun({
  onApplied,
  onExpired,
}: {
  onApplied: (receipt: CommandReceipt) => void
  onExpired: () => void
}) {
  const [phase, setPhase] = useState<RunPhase>({ kind: 'idle' })
  const busy = useRef(false)
  const identity = useRef<{ key: string; id: string } | null>(null)
  const last = useRef<RunArgs | null>(null)
  const callbacks = useRef({ onApplied, onExpired })
  callbacks.current = { onApplied, onExpired }

  const reconcile = useCallback(async () => {
    const id = identity.current?.id
    if (!id) return
    setPhase({ kind: 'reconciling' })
    const outcome = await fetchReceipt(id)
    if (outcome.ok && outcome.value) return callbacks.current.onApplied(outcome.value)
    if (outcome.ok)
      return setPhase({
        kind: 'failed',
        failure: { kind: 'unknown' },
        // O POST original ainda pode concluir depois deste GET, mesmo lendo do primário.
        verified: false,
        canRetry: false,
      })
    if (outcome.failure.kind === 'expired') {
      setPhase({ kind: 'idle' })
      return callbacks.current.onExpired()
    }
    setPhase({ kind: 'failed', failure: { kind: 'unknown' }, verified: false, canRetry: false })
  }, [])

  const run = useCallback(
    async (args: RunArgs) => {
      if (busy.current) return
      busy.current = true
      try {
        last.current = args
        const key = JSON.stringify(args)
        if (identity.current?.key !== key) identity.current = { key, id: crypto.randomUUID() }
        setPhase({ kind: 'submitting' })
        const base = { expectedRevision: args.revision, operationId: identity.current.id }
        const outcome = await runCommand(
          args.action === 'startV2'
            ? { action: 'startV2', ...base, document: args.document }
            : { action: 'convertToV2', ...base, acknowledge: args.acknowledge },
        )
        if (outcome.ok) return callbacks.current.onApplied(outcome.value)
        const { failure } = outcome
        if (failure.kind === 'expired') {
          setPhase({ kind: 'idle' })
          return callbacks.current.onExpired()
        }
        if (failure.kind === 'unknown') return await reconcile()
        setPhase({
          kind: 'failed',
          failure,
          verified: true,
          canRetry: failure.kind === 'unavailable',
        })
      } finally {
        busy.current = false
      }
    },
    [reconcile],
  )

  return {
    phase,
    run,
    /** Repete a MESMA operação (mesmo `operationId`); só é oferecido quando é seguro. */
    retry: useCallback(() => {
      if (last.current) void run(last.current)
    }, [run]),
    /** Pergunta ao servidor se a operação foi gravada, sem reenviar nada. */
    verify: useCallback(async () => {
      if (busy.current) return
      busy.current = true
      try {
        await reconcile()
      } finally {
        busy.current = false
      }
    }, [reconcile]),
    reset: useCallback(() => setPhase({ kind: 'idle' }), []),
  }
}

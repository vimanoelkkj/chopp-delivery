import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchUploadReceipt, type MediaFailure, type UploadReceipt, uploadMedia } from './mediaApi'
import { dimensionProblem, type ImageMime, preflightFile } from './mediaModel'

export type UploadPhase =
  | { kind: 'idle' }
  | { kind: 'checking'; name: string }
  | { kind: 'uploading'; name: string }
  /** Resposta inconclusiva: perguntando ao servidor, pelo recibo, o que aconteceu. */
  | { kind: 'confirming'; name: string }
  | { kind: 'done'; media: UploadReceipt['media'] }
  /** O arquivo foi recusado aqui mesmo: nada foi enviado e nenhum registro da cota foi usado. */
  | { kind: 'refused'; message: string }
  /** O servidor respondeu com um erro definitivo. Um novo envio precisa de nova operação. */
  | { kind: 'failed'; failure: MediaFailure }
  /**
   * Não se sabe o desfecho. `canRepeat` só é verdadeiro quando o servidor disse que não há registro
   * da operação: então, e só então, o administrador pode repetir A MESMA operação (mesmo ID e bytes).
   */
  | { kind: 'uncertain'; why: 'unknown' | 'running' | 'absent'; canRepeat: boolean }

type Pending = { file: File; mime: ImageMime; operationId: string }

/** Lê o tamanho real da imagem no navegador, quando ele sabe decodificá-la. */
async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}

/**
 * Envio de uma imagem à biblioteca, com as garantias de recuperação do M2B:
 * - nada roda ao montar: só `start`, chamado pela escolha do arquivo;
 * - um envio por vez (cliques e escolhas repetidas são ignorados enquanto há um em andamento);
 * - o `operationId` nasce no `start`; repeti-lo com os mesmos bytes é idempotente no servidor;
 * - NUNCA há reenvio automático: se o desfecho for incerto, o recibo é consultado primeiro e só um
 *   clique do administrador repete a operação, e quando a consulta não encontrou recibo, sem presumir ausência de gravação;
 * - o upload não toca o documento editorial: salvar a associação continua sendo "Salvar rascunho".
 */
export function useMediaUpload({
  onUploaded,
  onExpired,
}: {
  onUploaded: (media: UploadReceipt['media']) => void
  onExpired: () => void
}) {
  const [phase, setPhase] = useState<UploadPhase>({ kind: 'idle' })
  const busy = useRef(false)
  const pending = useRef<Pending | null>(null)
  const callbacks = useRef({ onUploaded, onExpired })
  callbacks.current = { onUploaded, onExpired }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const expire = useCallback(() => {
    pending.current = null
    setPhase({ kind: 'idle' })
    callbacks.current.onExpired()
  }, [])

  const finish = useCallback((receipt: UploadReceipt) => {
    pending.current = null
    if (receipt.operation.status === 'done') {
      setPhase({ kind: 'done', media: receipt.media })
      callbacks.current.onUploaded(receipt.media)
    } else setPhase({ kind: 'failed', failure: { kind: 'failed-record' } })
  }, [])

  const confirm = useCallback(
    async (name: string) => {
      const current = pending.current
      if (!current) return
      setPhase({ kind: 'confirming', name })
      const outcome = await fetchUploadReceipt(current.operationId)
      if (!mounted.current) return
      if (!outcome.ok) {
        if (outcome.failure.kind === 'expired') return expire()
        return setPhase({ kind: 'uncertain', why: 'unknown', canRepeat: false })
      }
      const found = outcome.value
      if (found.kind === 'receipt') return finish(found.receipt)
      if (found.kind === 'running')
        return setPhase({ kind: 'uncertain', why: 'running', canRepeat: false })
      setPhase({ kind: 'uncertain', why: 'absent', canRepeat: true })
    },
    [expire, finish],
  )

  const attempt = useCallback(
    async (name: string, repeating = false) => {
      const current = pending.current
      if (!current) return
      setPhase({ kind: 'uploading', name })
      const outcome = await uploadMedia({
        file: current.file,
        mime: current.mime,
        operationId: current.operationId,
      })
      if (!mounted.current) return
      if (outcome.ok) return finish(outcome.value)
      const { failure } = outcome
      if (failure.kind === 'expired') return expire()
      // Uma rejeição do replay não resolve o envio anterior (ex.: 409 enquanto ele ainda roda).
      // Rede, timeout ou replay recusado: consultar o recibo sem perder a identidade pendente.
      if (failure.kind === 'unknown' || repeating) return await confirm(name)
      pending.current = null
      setPhase({ kind: 'failed', failure })
    },
    [confirm, expire, finish],
  )

  const start = useCallback(
    async (file: File) => {
      if (busy.current || pending.current) return
      busy.current = true
      try {
        setPhase({ kind: 'checking', name: file.name })
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
        const checked = preflightFile(file, head)
        if (!mounted.current) return
        if (!checked.ok) {
          pending.current = null
          return setPhase({ kind: 'refused', message: checked.message })
        }
        const size = await readDimensions(file)
        if (!mounted.current) return
        if (!size) {
          pending.current = null
          return setPhase({
            kind: 'refused',
            message: 'O navegador não conseguiu abrir esta imagem. Ela pode estar corrompida.',
          })
        }
        const problem = dimensionProblem(size.width, size.height)
        if (problem) {
          pending.current = null
          return setPhase({ kind: 'refused', message: problem })
        }
        pending.current = { file, mime: checked.mime, operationId: crypto.randomUUID() }
        await attempt(file.name)
      } finally {
        busy.current = false
      }
    },
    [attempt],
  )

  /** Pergunta ao servidor o que houve com o envio, sem reenviar nada. */
  const verify = useCallback(async () => {
    if (busy.current || !pending.current) return
    busy.current = true
    try {
      await confirm(pending.current.file.name)
    } finally {
      busy.current = false
    }
  }, [confirm])

  /** Replay explícito da MESMA operação; 404 continua inconclusivo, nunca libera outra identidade. */
  const repeat = useCallback(async () => {
    if (busy.current || !pending.current || phase.kind !== 'uncertain' || !phase.canRepeat) return
    busy.current = true
    try {
      await attempt(pending.current.file.name, true)
    } finally {
      busy.current = false
    }
  }, [attempt, phase])

  const reset = useCallback(() => {
    if (busy.current || pending.current) return
    pending.current = null
    setPhase({ kind: 'idle' })
  }, [])

  const working = ['checking', 'uploading', 'confirming'].includes(phase.kind)
  return { phase, working, start, verify, repeat, reset }
}

import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from 'react'
import styles from './TickerMarquee.module.css'

export const DEFAULT_TICKER_PHRASES = [
  'Chope gelado',
  'Barril 30 L',
  'Barril 50 L',
  'Delivery',
  'Retirada',
] as const

export type TickerMarqueeProps = {
  /** Frases a serem exibidas. Padrão: 5 frases oficiais Delegas. */
  phrases?: readonly string[]
  /** Velocidade linear em pixels por segundo. Padrão: 55 px/s (moderada e legível). */
  speed?: number
  /** Pausa forçada da animação (ex: botão de controle ou hover). */
  paused?: boolean
  /** Simulação de prefers-reduced-motion para prévias e diagnósticos. */
  forceReducedMotion?: boolean
  /** Classe CSS customizada para o contêiner raiz. */
  className?: string
  /** Callback opcional com diagnósticos de dimensionamento para prévia e testes. */
  onMetricsChange?: (metrics: {
    containerWidth: number
    sequenceWidth: number
    singleSetWidth: number
    repetitions: number
    calculatedDuration: number
  }) => void
}

/**
 * Letreiro amarelo infinito (Seamless Marquee).
 *
 * Princípio mecânico:
 * 1. O trilho contém duas sequências idênticas (Primary e Secondary).
 * 2. Cada sequência tem repetições suficientes para que sua largura exceda a largura do contêiner.
 * 3. O trilho desliza exatamente 50% de sua largura total (-100% de uma sequência).
 * 4. No instante em que Primary sai inteira à esquerda, Secondary está exatamente onde Primary começou.
 * 5. Ao reiniciar o ciclo de keyframes, o salto é de 0 pixels (imperceptível).
 * 6. A velocidade linear (px/s) permanece constante independentemente da resolução.
 * 7. Em prefers-reduced-motion, a animação é cessada, a duplicata secundária e repetições extras
 *    são ocultadas, e nenhuma faixa rolável horizontal inacessível é criada.
 */
export function TickerMarquee({
  phrases = DEFAULT_TICKER_PHRASES,
  speed = 55,
  paused = false,
  forceReducedMotion = false,
  className,
  onMetricsChange,
}: TickerMarqueeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const singleSetRef = useRef<HTMLUListElement>(null)
  const accessibleId = useId()

  // Base mínima de repetições por sequência (4 cópias cobrem confortavelmente até monitores 4K de 3840px)
  const [repetitions, setRepetitions] = useState<number>(4)
  const [duration, setDuration] = useState<number>(85)

  const measureAndAdjust = useCallback(() => {
    const container = containerRef.current
    const singleSet = singleSetRef.current
    if (!container || !singleSet) return

    const containerWidth = container.clientWidth
    // getBoundingClientRect fornece largura precisa com suporte a sub-pixels e renderização de fontes
    const singleSetWidth = Math.ceil(singleSet.getBoundingClientRect().width)

    if (containerWidth > 0 && singleSetWidth > 0) {
      // Garantir que 1 sequência cubra com folga a largura visível da tela
      // Ex.: se container tem 3840px (4K) e o bloco tem 1200px => ceil(3840/1200) + 1 = 5 cópias (6000px).
      const needed = Math.max(4, Math.ceil(containerWidth / singleSetWidth) + 1)
      setRepetitions((prev) => (prev !== needed ? needed : prev))

      const totalSequenceWidth = singleSetWidth * needed
      const safeSpeed = Math.max(10, speed)
      const calculatedDuration = Math.round(totalSequenceWidth / safeSpeed)

      // Atualiza duração apenas se a diferença for relevante (> 1s), evitando oscilação de keyframes
      setDuration((prev) => (Math.abs(prev - calculatedDuration) > 1 ? calculatedDuration : prev))

      onMetricsChange?.({
        containerWidth,
        sequenceWidth: totalSequenceWidth,
        singleSetWidth,
        repetitions: needed,
        calculatedDuration,
      })
    }
  }, [speed, onMetricsChange])

  useEffect(() => {
    measureAndAdjust()

    // Atualiza após carregamento de fontes (Big Shoulders Display altera largura do texto)
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(measureAndAdjust)
    }

    const container = containerRef.current
    const singleSet = singleSetRef.current
    if (!container || !singleSet || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureAndAdjust)
      return () => window.removeEventListener('resize', measureAndAdjust)
    }

    // Observa tanto o contêiner quanto a sequência unitária de texto
    // Garante reação imediata a mudanças de fontes, zoom ou largura de janela
    const observer = new ResizeObserver(() => {
      measureAndAdjust()
    })
    observer.observe(container)
    observer.observe(singleSet)

    return () => {
      observer.disconnect()
    }
  }, [measureAndAdjust])

  const styleVariables = {
    '--marquee-duration': `${duration}s`,
  } as CSSProperties

  // Renderiza um conjunto único de frases
  const renderPhraseSet = (keyPrefix: string, isMeasureRef = false) => (
    <ul
      key={keyPrefix}
      ref={isMeasureRef ? singleSetRef : undefined}
      className={styles.phraseSet}
      aria-hidden="true"
    >
      {phrases.map((phrase) => (
        <li key={`${keyPrefix}-${phrase}`} className={styles.item}>
          {phrase}
        </li>
      ))}
    </ul>
  )

  // Renderiza uma sequência completa (com o número calculado de repetições)
  const renderSequence = (sequenceKey: string, isFirstSequence = false) => (
    <div
      key={sequenceKey}
      className={isFirstSequence ? styles.sequencePrimary : styles.sequenceSecondary}
      aria-hidden="true"
    >
      {Array.from({ length: repetitions }).map((_, index) =>
        renderPhraseSet(
          `${sequenceKey}-rep-${index}`,
          isFirstSequence && index === 0, // primeira unidade usada como referência de medição
        ),
      )}
    </div>
  )

  return (
    <section
      ref={containerRef}
      className={[styles.ticker, className].filter(Boolean).join(' ')}
      style={styleVariables}
      data-paused={paused ? 'true' : undefined}
      data-reduced-motion={forceReducedMotion ? 'true' : undefined}
      aria-labelledby={accessibleId}
    >
      {/* Informação textual acessível para leitores de tela sem repetições infinitas */}
      <h2 id={accessibleId} className={styles.srOnly}>
        Destaques: {phrases.join(', ')}
      </h2>

      {/* Trilho visual contínuo com duas metades idênticas */}
      <div className={styles.track}>
        {renderSequence('sequence-a', true)}
        {renderSequence('sequence-b', false)}
      </div>
    </section>
  )
}

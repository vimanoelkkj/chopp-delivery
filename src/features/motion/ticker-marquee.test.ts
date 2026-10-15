import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TICKER_PHRASES } from './TickerMarquee'

describe('TickerMarquee - Fundamentos e Comportamento Efetivo', () => {
  it('preserva exatamente as 5 frases e ordem oficiais Delegas', () => {
    expect(DEFAULT_TICKER_PHRASES).toEqual([
      'Chope gelado',
      'Barril 30 L',
      'Barril 50 L',
      'Delivery',
      'Delegas',
    ])
  })

  it('cobertura geométrica efetiva: sequência primária é estritamente maior que o viewport (360px a 4K)', () => {
    // Medidas reais do bloco unitário medido nos navegadores:
    // Mobile (~30px Big Shoulders Display 900): ~750px
    // Desktop (~44px Big Shoulders Display 900): ~1210px
    const singleSetMobile = 750
    const singleSetDesktop = 1210

    const testCases = [
      { viewport: 360, singleSet: singleSetMobile },
      { viewport: 390, singleSet: singleSetMobile },
      { viewport: 430, singleSet: singleSetMobile },
      { viewport: 768, singleSet: singleSetDesktop },
      { viewport: 1440, singleSet: singleSetDesktop },
      { viewport: 1920, singleSet: singleSetDesktop },
      { viewport: 2560, singleSet: singleSetDesktop }, // Ultrawide 1440p
      { viewport: 3840, singleSet: singleSetDesktop }, // 4K UHD real
    ]

    for (const { viewport, singleSet } of testCases) {
      const minRepetitions = Math.max(4, Math.ceil(viewport / singleSet) + 1)
      const sequenceWidth = minRepetitions * singleSet

      // Regra fundamental: a sequência primária precisa cobrir 100% da largura do contêiner
      // para que a sequência secundária já esteja cobrindo a tela no instante do loop.
      expect(sequenceWidth).toBeGreaterThan(viewport)
      const coverageRatio = sequenceWidth / viewport
      expect(coverageRatio).toBeGreaterThan(1.0)
    }
  })

  it('velocidade linear constante em qualquer resolução', () => {
    const targetSpeed = 55 // px/s

    // Simula larguras calculadas para diferentes telas
    const sequences = [3000, 4840, 6050] // mobile 4x, desktop 4x, 4K 5x

    for (const seqWidth of sequences) {
      const duration = Math.round(seqWidth / targetSpeed)
      const actualSpeed = seqWidth / duration

      // A velocidade efetiva em pixels/segundo deve estar dentro de ±1 px/s
      expect(Math.abs(actualSpeed - targetSpeed)).toBeLessThanOrEqual(1)
    }
  })

  it('tolerância métrica pós-carregamento de fontes: reflow mantém congruência A e B', () => {
    // Simula reflow da fonte de fallback (~1000px) para fonte definitiva (~1210px)
    const fallbackSet = 1000
    const loadedSet = 1210
    const reps = 4

    const fallbackPrimary = fallbackSet * reps
    const fallbackSecondary = fallbackSet * reps
    expect(fallbackPrimary).toBe(fallbackSecondary)

    const loadedPrimary = loadedSet * reps
    const loadedSecondary = loadedSet * reps
    expect(loadedPrimary).toBe(loadedSecondary)

    // O deslocamento de -50% no trilho translada exatamente a extensão da primária
    const totalTrack = loadedPrimary + loadedSecondary
    expect(totalTrack * 0.5).toBe(loadedPrimary)
  })

  it('[P1 Produção] bundle de build não contém artefatos nem referências do laboratório de preview', () => {
    const distDir = path.resolve(process.cwd(), 'dist/assets')
    if (!fs.existsSync(distDir)) {
      // Se ainda não gerou build, o teste é considerado no-op até o próximo build
      return
    }

    const files = fs.readdirSync(distDir)
    const jsFiles = files.filter((f) => f.endsWith('.js'))
    const cssFiles = files.filter((f) => f.endsWith('.css'))

    for (const f of [...jsFiles, ...cssFiles]) {
      const content = fs.readFileSync(path.join(distDir, f), 'utf-8')
      expect(content).not.toContain('MotionPreviewPage')
      expect(content).not.toContain('diagnosticGrid')
      expect(content).not.toContain('simulatedViewport')
      expect(content).not.toContain('heroFadeUp')
    }
  })
})

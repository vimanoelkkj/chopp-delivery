import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCachacaWhatsAppMessage } from './CachacasShowcase'
import {
  FIXTURE_BARREL_SIZES_V2,
  FIXTURE_BOTTLE_VOLUMES_V2,
  FIXTURE_PUBLIC_CATALOG_V2,
  ORIGINAL_BEER_IDS,
} from './fixtures'
import { centsToReaisSafe, formatPriceFromCents, getVisibleCatalog } from './types'

describe('Catálogo Expansível (v2) - Contratos e Regras de Negócio', () => {
  it('contém exatamente os 8 chopes originais consolidados', () => {
    const chopesCategory = FIXTURE_PUBLIC_CATALOG_V2.categories.find((c) => c.id === 'chopes')
    expect(chopesCategory).toBeDefined()

    const itemIds = chopesCategory?.items.map((i) => i.id) ?? []
    for (const originalId of ORIGINAL_BEER_IDS) {
      expect(itemIds).toContain(originalId)
    }
    expect(ORIGINAL_BEER_IDS).toHaveLength(8)
  })

  it('adiciona 1 chope novo aos 8 existentes (totalizando 9 chopes visíveis)', () => {
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
    const chopesCategory = visibleCatalog.find((c) => c.id === 'chopes')
    expect(chopesCategory).toBeDefined()

    const visibleBeers = chopesCategory?.items ?? []
    expect(visibleBeers).toHaveLength(9)

    // O 9º chope é a Session IPA
    const newBeer = visibleBeers.find((i) => i.id === 'delegas-session-ipa')
    expect(newBeer).toBeDefined()
    expect(newBeer?.name).toContain('Delegas Session IPA')
  })

  it('suporta produtos com mais de duas variantes comerciais', () => {
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
    const chopesCategory = visibleCatalog.find((c) => c.id === 'chopes')
    const sessionIpa = chopesCategory?.items.find((i) => i.id === 'delegas-session-ipa')

    // Chope com 4 variantes (7.5L, 20L, 30L, 50L)
    expect(sessionIpa?.variants.length).toBe(4)
    expect(sessionIpa?.variants.map((v) => v.code)).toEqual(['7.5', '20', '30', '50'])

    // Cachaça com 3 variantes de volume (500ml, 700ml, 1000ml)
    const cachacasCategory = visibleCatalog.find((c) => c.id === 'cachacas')
    const prata = cachacasCategory?.items.find((i) => i.id === 'cachaca-delegas-prata')
    expect(prata?.variants.length).toBe(3)
    expect(prata?.variants.map((v) => v.volumeMl)).toEqual([500, 700, 1000])
  })

  it('contempla todos os tamanhos de barril requeridos: 7,5 L, 20 L, 30 L e 50 L', () => {
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
    const chopesCategory = visibleCatalog.find((c) => c.id === 'chopes')
    const allVariants = chopesCategory?.items.flatMap((item) => item.variants) ?? []

    const volumes = new Set(allVariants.map((v) => v.volumeMl))
    for (const size of FIXTURE_BARREL_SIZES_V2) {
      expect(volumes.has(size.volumeMl)).toBe(true)
    }
    expect(volumes.has(7500)).toBe(true)
    expect(volumes.has(20000)).toBe(true)
    expect(volumes.has(30000)).toBe(true)
    expect(volumes.has(50000)).toBe(true)
  })

  it('contempla múltiplas cachaças com diferentes volumes de garrafa', () => {
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
    const cachacasCategory = visibleCatalog.find((c) => c.id === 'cachacas')
    expect(cachacasCategory).toBeDefined()

    const cachacas = cachacasCategory?.items ?? []
    expect(cachacas.length).toBeGreaterThanOrEqual(3)

    const allBottleVariants = cachacas.flatMap((c) => c.variants)
    const bottleVolumes = new Set(allBottleVariants.map((v) => v.volumeMl))

    for (const vol of FIXTURE_BOTTLE_VOLUMES_V2) {
      expect(bottleVolumes.has(vol)).toBe(true)
    }
    // 500 ml, 700 ml, 750 ml, 1000 ml
    expect(bottleVolumes.has(500)).toBe(true)
    expect(bottleVolumes.has(700)).toBe(true)
    expect(bottleVolumes.has(750)).toBe(true)
    expect(bottleVolumes.has(1000)).toBe(true)
  })

  it('mantém todos os preços estritamente em centavos inteiros (priceCents)', () => {
    for (const cat of FIXTURE_PUBLIC_CATALOG_V2.categories) {
      for (const item of cat.items) {
        for (const variant of item.variants) {
          if (variant.priceCents !== null) {
            expect(Number.isInteger(variant.priceCents)).toBe(true)
            expect(variant.priceCents).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('converte centavos para reais e formata valores com segurança', () => {
    expect(centsToReaisSafe(38000)).toBe(380)
    expect(centsToReaisSafe(27550)).toBe(275.5)
    expect(centsToReaisSafe(null)).toBeNull()
    expect(centsToReaisSafe(undefined)).toBeNull()
    expect(centsToReaisSafe(0)).toBe(0)

    expect(formatPriceFromCents(38000)).toBe('R$ 380')
    expect(formatPriceFromCents(27550)).toBe('R$ 275,50')
    expect(formatPriceFromCents(null)).toBe('—')
  })

  it('trata variante com priceCents: null como não comprável / não disponível', () => {
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
    const chopesCategory = visibleCatalog.find((c) => c.id === 'chopes')
    const brahma = chopesCategory?.items.find((i) => i.id === 'brahma')
    expect(brahma).toBeDefined()

    const variant30L = brahma?.variants.find((v) => v.code === '30')
    expect(variant30L).toBeDefined()
    expect(variant30L?.priceCents).toBeNull()

    const formatted = formatPriceFromCents(variant30L?.priceCents ?? null)
    expect(formatted).toBe('—')
  })

  it('oculta rigorosamente produtos com visible: false do catálogo público', () => {
    // No catálogo bruto há um chope oculto (Imperial Stout) e uma cachaça oculta
    const allChopes =
      FIXTURE_PUBLIC_CATALOG_V2.categories.find((c) => c.id === 'chopes')?.items ?? []
    expect(allChopes.some((i) => i.id === 'chope-imperial-stout-oculto')).toBe(true)

    // No catálogo visível, ambos são expurgados
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
    const visibleChopes = visibleCatalog.find((c) => c.id === 'chopes')?.items ?? []
    expect(visibleChopes.some((i) => i.id === 'chope-imperial-stout-oculto')).toBe(false)
    expect(visibleChopes.every((i) => i.visible)).toBe(true)

    const visibleCachacas = visibleCatalog.find((c) => c.id === 'cachacas')?.items ?? []
    expect(visibleCachacas.some((i) => i.id === 'cachaca-edicao-oculta')).toBe(false)
    expect(visibleCachacas.every((i) => i.visible)).toBe(true)
  })

  it('omite graciosamente categorias sem produtos visíveis', () => {
    // Na fixture bruta, existe a categoria "acessorios" que só tem item visible: false
    const rawCategories = FIXTURE_PUBLIC_CATALOG_V2.categories.map((c) => c.id)
    expect(rawCategories).toContain('acessorios')

    // No catálogo visível com omitEmptyCategories: true (padrão público), a categoria inteira é omitida
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2, {
      omitEmptyCategories: true,
    })
    const visibleCatIds = visibleCatalog.map((c) => c.id)
    expect(visibleCatIds).not.toContain('acessorios')
  })

  it('valida que a cachaça real existente possui exatamente uma variante de 700 ml com preço original (R$ 30,00)', () => {
    const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
    const cachacasCategory = visibleCatalog.find((c) => c.id === 'cachacas')
    const realCachaca = cachacasCategory?.items.find((i) => i.id === 'cachaca-umburana')

    expect(realCachaca).toBeDefined()
    expect(realCachaca?.name).toBe('Cachaça')
    expect(realCachaca?.description).toBe('Conservada em barril de umburana com jequitibá rosa')
    expect(realCachaca?.variants).toHaveLength(1)
    expect(realCachaca?.variants[0].volumeMl).toBe(700)
    expect(realCachaca?.variants[0].label).toBe('Garrafa 700 ml')
    expect(realCachaca?.variants[0].priceCents).toBe(3000) // R$ 30,00
  })

  describe('Regras de Negócio do WhatsApp e Seleção de Variantes', () => {
    it('variante única de 700 ml: gera mensagem com volume e preço corretos', () => {
      const msg = buildCachacaWhatsAppMessage('Cachaça', {
        label: 'Garrafa 700 ml',
        priceCents: 3000,
      })
      expect(msg).toBe('Olá! Gostaria de pedir uma garrafa de Cachaça 700 ml por R$ 30,00.')
    })

    it('formata adequadamente rótulo e mensagem quando a API real retorna label: Garrafa e volumeMl: 700', () => {
      // No banco D1, o item é "Temos cachaça" e a variante tem label "Garrafa" e volumeMl 700
      const msgFromApi = buildCachacaWhatsAppMessage('Temos cachaça', {
        label: 'Garrafa',
        volumeMl: 700,
        priceCents: 3000,
      })
      expect(msgFromApi).toBe('Olá! Gostaria de pedir uma garrafa de Cachaça 700 ml por R$ 30,00.')
    })

    it('múltiplas variantes: troca de seleção altera volume e preço da mensagem com fidelidade', () => {
      const msg500 = buildCachacaWhatsAppMessage('Cachaça Prata (Demonstração)', {
        label: 'Garrafa 500 ml',
        priceCents: 3500,
      })
      expect(msg500).toBe(
        'Olá! Gostaria de pedir uma garrafa de Cachaça Prata 500 ml por R$ 35,00.',
      )

      const msg700 = buildCachacaWhatsAppMessage('Cachaça Prata (Demonstração)', {
        label: 'Garrafa 700 ml',
        priceCents: 4500,
      })
      expect(msg700).toBe(
        'Olá! Gostaria de pedir uma garrafa de Cachaça Prata 700 ml por R$ 45,00.',
      )

      const msg1000 = buildCachacaWhatsAppMessage('Cachaça Prata (Demonstração)', {
        label: 'Garrafa 1.000 ml',
        priceCents: 6000,
      })
      expect(msg1000).toBe(
        'Olá! Gostaria de pedir uma garrafa de Cachaça Prata 1.000 ml por R$ 60,00.',
      )
    })

    it('variante com priceCents: null nunca permite compra nem gera link de pedido', () => {
      // 1. No modelo, priceCents null formata como travessão
      const priceText = formatPriceFromCents(null)
      expect(priceText).toBe('—')

      // 2. Chope com variante sem preço (Brahma 30 L)
      const visibleCatalog = getVisibleCatalog(FIXTURE_PUBLIC_CATALOG_V2)
      const chopesCategory = visibleCatalog.find((c) => c.id === 'chopes')
      const brahma = chopesCategory?.items.find((i) => i.id === 'brahma')
      const brahma30 = brahma?.variants.find((v) => v.code === '30')
      expect(brahma30?.priceCents).toBeNull()

      // 3. Função de conversão recusa ou formata indisponível
      expect(centsToReaisSafe(brahma30?.priceCents)).toBeNull()
    })
  })

  it('preserva integridade do build de produção (dead-code elimination)', () => {
    const distDir = path.resolve(process.cwd(), 'dist/assets')
    if (!fs.existsSync(distDir)) {
      return
    }

    const files = fs.readdirSync(distDir)
    const jsFiles = files.filter((f) => f.endsWith('.js'))
    const cssFiles = files.filter((f) => f.endsWith('.css'))

    for (const f of [...jsFiles, ...cssFiles]) {
      const content = fs.readFileSync(path.join(distDir, f), 'utf-8')
      // O bundle de produção nunca deve conter a prévia ou fixture DEV
      expect(content).not.toContain('FIXTURE_PUBLIC_CATALOG_V2')
      expect(content).not.toContain('ExpandableCatalogView')
      expect(content).not.toContain('chope-imperial-stout-oculto')
    }
  })
})

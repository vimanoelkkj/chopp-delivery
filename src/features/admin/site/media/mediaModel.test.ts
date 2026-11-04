import { describe, expect, it } from 'vitest'
import { MEDIA_LIMITS } from '../../../../../server/cms/media-contract'
import { previewFixture } from '../../../../../tests/e2e-real/preview-fixture'
import type { MediaItem } from './mediaApi'
import {
  capacityView,
  dimensionProblem,
  formatBytes,
  MEDIA_UPLOAD_LIMITS,
  preflightFile,
  shortId,
  sniffImage,
  tileView,
  UPLOAD_RULES,
  uploadFailureText,
  usedMediaIds,
} from './mediaModel'

const ID = 'media_12345678-1234-4123-8123-123456789012'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])
const item = (state: MediaItem['state']): MediaItem => ({
  id: ID,
  state,
  revision: 'op',
  profiles: state === 'ready' ? ['hero', 'section'] : [],
  integrity: state === 'ready' ? 'not_checked' : 'unavailable',
})

describe('limites espelham o servidor', () => {
  it('tamanho, dimensão e megapixels são os mesmos de MEDIA_LIMITS', () => {
    expect(MEDIA_UPLOAD_LIMITS.bytes).toBe(MEDIA_LIMITS.inputBytes)
    expect(MEDIA_UPLOAD_LIMITS.dimension).toBe(MEDIA_LIMITS.dimension)
    expect(MEDIA_UPLOAD_LIMITS.pixels).toBe(MEDIA_LIMITS.pixels)
  })
  it('a regra mostrada ao administrador cita formato, tamanho e o custo da cota', () => {
    expect(UPLOAD_RULES).toMatch(/PNG, JPEG ou WebP/)
    expect(UPLOAD_RULES).toMatch(/5 MB/)
    expect(UPLOAD_RULES).toMatch(/6000 px/)
    expect(UPLOAD_RULES).toMatch(/mesmo se for recusado/)
  })
})

describe('assinatura do arquivo', () => {
  it('reconhece PNG, JPEG e WebP pelos primeiros bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png')
    expect(sniffImage(JPEG)).toBe('image/jpeg')
    expect(sniffImage(WEBP)).toBe('image/webp')
  })
  it('recusa o que não é imagem aceita (GIF, texto, RIFF que não é WebP)', () => {
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('<svg xmlns=...'))).toBeNull()
    expect(
      sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])),
    ).toBeNull()
    expect(sniffImage(new Uint8Array(0))).toBeNull()
  })
})

describe('conferência antes do envio', () => {
  it('aceita PNG, JPEG e WebP dentro do limite, inclusive exatamente 5 MB', () => {
    expect(preflightFile({ size: 1000, type: 'image/png' }, PNG)).toEqual({
      ok: true,
      mime: 'image/png',
    })
    expect(preflightFile({ size: 1000, type: 'image/jpeg' }, JPEG)).toMatchObject({ ok: true })
    expect(preflightFile({ size: 1000, type: 'image/webp' }, WEBP)).toMatchObject({ ok: true })
    expect(
      preflightFile({ size: MEDIA_UPLOAD_LIMITS.bytes, type: 'image/png' }, PNG),
    ).toMatchObject({
      ok: true,
    })
  })
  it('um tipo vazio (alguns sistemas) vale pela assinatura real', () => {
    expect(preflightFile({ size: 10, type: '' }, JPEG)).toEqual({ ok: true, mime: 'image/jpeg' })
  })
  it('recusa vazio, grande demais, formato e conteúdo que não batem — com a razão dita', () => {
    const empty = preflightFile({ size: 0, type: 'image/png' }, PNG)
    expect(empty).toEqual({ ok: false, message: 'O arquivo está vazio.' })
    const big = preflightFile({ size: MEDIA_UPLOAD_LIMITS.bytes + 1, type: 'image/png' }, PNG)
    expect(big.ok).toBe(false)
    expect(!big.ok && big.message).toMatch(/limite é 5 MB/)
    const gif = preflightFile({ size: 10, type: 'image/gif' }, PNG)
    expect(!gif.ok && gif.message).toMatch(/Use PNG, JPEG ou WebP/)
    // extensão/tipo dizem PNG, mas os bytes são de outra coisa
    const lying = preflightFile({ size: 10, type: 'image/png' }, JPEG)
    expect(!lying.ok && lying.message).toMatch(/conteúdo/)
    const text = preflightFile(
      { size: 10, type: 'image/png' },
      new TextEncoder().encode('not an image'),
    )
    expect(text.ok).toBe(false)
  })
})

describe('dimensões', () => {
  it('aceita até 6000 px e 12 megapixels', () => {
    expect(dimensionProblem(4000, 3000)).toBeNull()
    expect(dimensionProblem(6000, 2000)).toBeNull()
  })
  it('recusa lado acima de 6000 e área acima de 12 MP, dizendo os números', () => {
    expect(dimensionProblem(6001, 100)).toMatch(/6001 × 100 px/)
    expect(dimensionProblem(4001, 3000)).toMatch(/megapixels/)
  })
})

describe('apresentação', () => {
  it('formatBytes usa vírgula decimal e omite ,0', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1)).toBe('1 KB')
  })
  it('cota: usado, restante e nível (baixa em 10, esgotada em 0)', () => {
    expect(capacityView({ limit: 100, consumed: 7, remaining: 93 })).toMatchObject({
      used: '7 de 100 registros usados',
      remaining: '93 envios restantes',
      level: 'ok',
    })
    expect(capacityView({ limit: 100, consumed: 90, remaining: 10 }).level).toBe('low')
    expect(capacityView({ limit: 100, consumed: 99, remaining: 1 }).remaining).toBe(
      '1 envio restante',
    )
    const full = capacityView({ limit: 100, consumed: 100, remaining: 0 })
    expect(full.level).toBe('full')
    expect(full.remaining).toBe('Nenhum envio restante')
    expect(full.note).toMatch(/vitalícia/)
  })
  it('shortId é estável e curto', () => {
    expect(shortId(ID)).toBe('12345678')
  })
})

describe('seleção: só vale o que o servidor entregou de fato', () => {
  it('pronta e miniatura carregada é selecionável; verificando e falha não', () => {
    expect(tileView(item('ready'), 'ready')).toMatchObject({ selectable: true, tone: 'ok' })
    expect(tileView(item('ready'), 'loading')).toMatchObject({
      selectable: false,
      label: 'Verificando…',
    })
    expect(tileView(item('ready'), 'failed')).toMatchObject({
      selectable: false,
      label: 'Indisponível',
      tone: 'bad',
    })
  })
  it('nenhum outro estado é selecionável, mesmo com a miniatura "carregada"', () => {
    for (const state of ['processing', 'quarantined', 'rejected', 'deleting', 'deleted'] as const)
      expect(tileView(item(state), 'ready').selectable, state).toBe(false)
  })
})

describe('mídia em uso', () => {
  it('reúne as imagens de seções e das entradas da vitrine', () => {
    const doc = previewFixture()
    const hero = doc.modules.find((m) => m.template === 'hero')
    const carousel = doc.modules.find((m) => m.template === 'carousel')
    if (hero?.template !== 'hero' || carousel?.template !== 'carousel') throw new Error('fixture')
    hero.content.media = { id: ID, alt: 'a' }
    const other = 'media_22222222-1234-4123-8123-123456789012'
    carousel.content.entries = [{ itemId: 'dronken', media: { id: other, alt: 'b' } }]
    expect([...usedMediaIds(doc)].sort()).toEqual([ID, other].sort())
    expect(usedMediaIds(previewFixture()).size).toBe(0)
  })
})

describe('textos de falha dizem o que aconteceu', () => {
  it('envio incerto não afirma falha nem sucesso e avisa que o recibo ausente não prova nada', () => {
    const text = uploadFailureText({ kind: 'unknown' })
    expect(`${text.title} ${text.text}`).toMatch(/pode ter sido recebida/)
    expect(text.text).toMatch(/não prova/)
  })
  it('recusas definitivas explicam o que fazer e a cota', () => {
    expect(uploadFailureText({ kind: 'quota' }).text).toMatch(/Não dá para enviar/)
    expect(uploadFailureText({ kind: 'too-large' }).text).toMatch(/5 MB/)
    expect(uploadFailureText({ kind: 'failed-record' }).text).toMatch(/cota/)
    expect(uploadFailureText({ kind: 'unsupported' }).title).toMatch(/não está disponível/)
  })
})

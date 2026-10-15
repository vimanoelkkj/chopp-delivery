/**
 * Apresentação de volumes. `volumeMl` (inteiro, vindo do servidor) é a fonte de verdade: o texto
 * do rótulo só é aceito como "já informa o volume" se uma quantidade INEQUÍVOCA nele equivale, em
 * ml e com aritmética inteira, a esse valor. Uma única implementação serve tabela, chips, cards,
 * cachaças e mensagens do WhatsApp.
 *
 * Gramática estrita (allowlist, não lista de proibidos). Uma quantidade é `número unidade`:
 *   número  = dígitos ASCII, com `.` ou `,` como separador (7,5 · 7.5 · 1.000 · 1.234,5);
 *   unidade = ml | l | lt | lts | litro | litros (ASCII, sem diferenciar caixa), seguida de algo
 *             que não seja letra, número, marca combinante nem caractere de formato;
 *   entre número e unidade, só espaço ASCII, tabulação ou NBSP.
 * E ela só VALE se o que a precede for limpo: início do rótulo, ou espaços comuns/pontuação neutra
 * ligando-a a uma palavra ou número. Tudo mais, em qualquer posição do trecho que a antecede, a
 * torna não reconhecida: qualquer traço ou sinal, qualquer caractere invisível, de formato, de
 * controle, marca combinante, espaço exótico ou símbolo. Nada é removido nem normalizado para
 * "consertar" um rótulo: o que não é inequívoco simplesmente não suprime o volume canônico.
 */
export type VolumeUnit = 'L' | 'ml'

type Presentable = { label: string; volumeMl?: number | null }

// Número + unidade (a unidade em classes ASCII explícitas: sem `i`, que casaria "ſ" e "K").
const CANDIDATE =
  /(\d+(?:[.,]\d+)*)[ \t ]*([mM][lL]|[lL][iI][tT][rR][oO][sS]?|[lL][tT][sS]?|[lL])(?![\p{L}\p{N}\p{M}\p{Cf}])/gu

const SPACING = /^[ \t ]$/u
// Pontuação neutra: pode ficar entre a palavra e a quantidade ("Volume: 20 L", "(20 L)", "/ 20 L").
const NEUTRAL = /^[()[\]{}:;,./|·]$/u
// '.' e ',' colados à quantidade fariam parte do número: ficam de fora do "colado".
const GLUE_OK = /^[()[\]{}:;/|·]$/u
const WORD = /^[\p{L}\p{N}]$/u
// Traços e sinais de menos de qualquer script/forma.
const DASH = /^[\p{Pd}⁻₋˗−➖﹣－]$/u
// Inclui caracteres ignoráveis que o Unicode classifica como letras (ex.: Hangul Filler).
// Não imprimíveis, marcas e separadores raros também não podem ancorar uma quantidade positiva.
const INVISIBLE = /^[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}\p{M}\p{Z}\p{Co}\p{Cn}]$/u

type Verdict = 'clean' | 'signed' | 'ambiguous'

/**
 * Lê para trás, a partir de `start`, tudo que antecede a quantidade e decide:
 * - `signed`: há um traço/sinal de menos no trecho (mesmo atrás de invisíveis ou pontuação);
 * - `ambiguous`: há algo que não é inequívoco (invisível, símbolo, "+", colado a letra, etc.);
 * - `clean`: só espaços comuns e pontuação neutra até o início ou até uma palavra/número.
 */
function verdictBefore(label: string, start: number): Verdict {
  const before = [...label.slice(0, start)] // por ponto de código: astral também conta
  if (before.length === 0) return 'clean'
  const adjacent = before[before.length - 1]
  // Colado ao número só vale espaço comum/NBSP/tab ou pontuação neutra de abertura/separação.
  let odd = !(SPACING.test(adjacent) || GLUE_OK.test(adjacent))
  for (let index = before.length - 1; index >= 0; index--) {
    const char = before[index]
    if (SPACING.test(char) || NEUTRAL.test(char)) continue
    // Traço colado a uma palavra/número ("Barril-20 L", "10-20 L") é hífen ou faixa, não sinal.
    if (DASH.test(char)) return index > 0 && WORD.test(before[index - 1]) ? 'ambiguous' : 'signed'
    if (INVISIBLE.test(char)) {
      odd = true // invisível/formato/marca/espaço exótico: não presumimos o que ele esconde
      continue
    }
    if (WORD.test(char)) break // uma palavra ou número ancora a quantidade
    return 'ambiguous' // símbolo ou pontuação não neutra ("+", "~", "*", "=", "@"...)
  }
  return odd ? 'ambiguous' : 'clean'
}

type Candidate = { start: number; end: number; ml: number[]; verdict: Verdict }

const MAX_DIGITS = 9

/** Interpretações possíveis de "1.000", "7,5", "7.5", "1.234,5" como [parte inteira, fração]. */
function readings(number: string): [string, string][] {
  const dots = number.split('.').length - 1
  const commas = number.split(',').length - 1
  if (dots && commas) {
    const cut = Math.max(number.lastIndexOf('.'), number.lastIndexOf(','))
    const decimal = number[cut]
    const groups = number.slice(0, cut).split(decimal === ',' ? '.' : ',')
    const fraction = number.slice(cut + 1)
    // Com dois separadores, um agrupa milhares e o último separa a fração.
    // Não se apaga pontuação arbitrária para transformar "1.2.3,4" em "123,4".
    if (
      !/^\d{1,3}$/.test(groups[0]) ||
      groups.slice(1).some((group) => !/^\d{3}$/.test(group)) ||
      !/^\d+$/.test(fraction)
    )
      return []
    return [[groups.join(''), fraction]]
  }
  const separator = dots ? '.' : commas ? ',' : ''
  if (!separator) return [[number, '']]
  const parts = number.split(separator)
  const last = parts[parts.length - 1]
  const out: [string, string][] = []
  if (parts.length === 2) out.push([parts[0], last]) // decimal
  if (last.length === 3 && parts.slice(1).every((part) => part.length === 3))
    out.push([parts.join(''), '']) // milhar: 1.000 / 1.234.567
  return out
}

function toMl(whole: string, fraction: string, unit: 'ml' | 'l'): number | null {
  if (whole.length > MAX_DIGITS) return null
  if (unit === 'ml') return /^0*$/.test(fraction) ? Number(whole) : null
  if (fraction.length > 3) return null
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
}

/** Todas as quantidades `número unidade` do rótulo, cada uma com seu veredito de contexto. */
function candidates(label: string): Candidate[] {
  const found: Candidate[] = []
  for (const match of label.matchAll(CANDIDATE)) {
    const unit = match[2].toLowerCase() === 'ml' ? 'ml' : 'l'
    const ml: number[] = []
    for (const [whole, fraction] of readings(match[1])) {
      const value = toMl(whole, fraction, unit)
      if (value !== null) ml.push(value)
    }
    const start = match.index ?? 0
    const verdict = verdictBefore(label, start)
    found.push({
      start,
      end: start + match[0].length,
      ml,
      verdict: verdict === 'clean' && ml.length === 0 ? 'ambiguous' : verdict,
    })
  }
  return found
}

/** Volumes (em ml) de quantidades INEQUÍVOCAS do rótulo. Sinais, invisíveis e ambíguos ficam de fora. */
export function volumesInLabel(label: string): number[] {
  return candidates(label)
    .filter((candidate) => candidate.verdict === 'clean')
    .flatMap((candidate) => candidate.ml)
}

export const labelStatesVolume = (label: string, volumeMl: number) =>
  volumesInLabel(label).includes(volumeMl)

/**
 * Inconsistência entre o rótulo e o `volumeMl`, para sinalizar (nunca corrigir):
 * - `negative`: traço/sinal de menos antes de uma quantidade ("Barril -20 L", também atrás de
 *   invisíveis como U+2063, U+200E, U+200F);
 * - `mismatch`: quantidades inequívocas, mas nenhuma equivale ao `volumeMl`;
 * - `ambiguous`: quantidade que a gramática não aceita como inequívoca (invisível, "+", faixa...);
 * - `null`: coerente, sem quantidade, ou sem `volumeMl` para comparar.
 * O rótulo persistido continua aparecendo literalmente; o volume canônico vem ao lado.
 */
export type VolumeLabelIssue = 'negative' | 'mismatch' | 'ambiguous'
export function volumeLabelIssue(variant: Presentable): VolumeLabelIssue | null {
  const { label, volumeMl } = variant
  if (volumeMl == null) return null
  const found = candidates(label)
  if (found.some((candidate) => candidate.verdict === 'signed')) return 'negative'
  const clean = found.filter((candidate) => candidate.verdict === 'clean').flatMap((c) => c.ml)
  if (clean.includes(volumeMl)) return null
  if (clean.length > 0) return 'mismatch'
  return found.some((candidate) => candidate.verdict === 'ambiguous') ? 'ambiguous' : null
}

/** ml → texto, exato e sem ponto flutuante: 7500 → "7,5 L", 20000 → "20 L", 1000 ml → "1.000 ml". */
export function formatVolume(volumeMl: number, unit: VolumeUnit): string {
  if (unit === 'ml') return `${volumeMl.toLocaleString('pt-BR')} ml`
  const rest = String(volumeMl % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${Math.trunc(volumeMl / 1000).toLocaleString('pt-BR')}${rest ? `,${rest}` : ''} L`
}

/** Texto do volume a acrescentar ao rótulo, ou `null` se não há volume ou o rótulo já o informa. */
function missingVolume(variant: Presentable, unit: VolumeUnit): string | null {
  const { label, volumeMl } = variant
  if (volumeMl == null || labelStatesVolume(label, volumeMl)) return null
  return formatVolume(volumeMl, unit)
}

/** Rótulo + volume sem repetir: "Barril especial · 20 L", mas "Barril de 30 L" fica como está. */
export function formatPresentation(variant: Presentable, unit: VolumeUnit, joiner = ' · '): string {
  const volume = missingVolume(variant, unit)
  return volume === null ? variant.label : `${variant.label}${joiner}${volume}`
}

/** Rótulo de garrafa: "Garrafa" + 700 → "Garrafa 700 ml"; "Garrafa 1000 ml" + 1000 não duplica. */
export const formatBottleLabel = (variant: Presentable) => formatPresentation(variant, 'ml', ' ')

/**
 * Como a garrafa é citada na mensagem: só o volume quando o rótulo é apenas "Garrafa" (com ou sem
 * o volume INEQUÍVOCO), senão o rótulo com o volume que faltar.
 */
export function bottlePresentation(variant: Presentable): string {
  const { label, volumeMl } = variant
  if (volumeMl == null) return label.replace(/garrafa\s+/i, '')
  const volume = formatVolume(volumeMl, 'ml')
  const stated = candidates(label).filter(
    (candidate) => candidate.verdict === 'clean' && candidate.ml.includes(volumeMl),
  )
  let rest = label
  for (const { start, end } of [...stated].reverse()) rest = rest.slice(0, start) + rest.slice(end)
  rest = rest.trim().toLocaleLowerCase('pt-BR')
  if (rest === '' || rest === 'garrafa') return volume
  return formatPresentation(variant, 'ml')
}

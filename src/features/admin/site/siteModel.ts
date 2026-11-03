import { CMS_LIMITS } from '../../../../shared/cms/common'
import { type DerivedCmsLayout, deriveLayout } from '../../../../shared/cms/layout'
import { cmsRevision, exact } from '../../../../shared/cms/primitives'
import {
  CMS_RULES_V2,
  type CmsCarouselEntry,
  type CmsDocumentV2,
  type CmsModuleV2,
  type CmsTemplateV2,
} from '../../../../shared/cms/v2'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'

/**
 * Leitura da "Página inicial" (E5): modelo puro, sem rede e sem DOM. Nada aqui escreve, converte ou
 * inicializa documentos; só interpreta o snapshot que `GET /api/admin/site` já devolve.
 */

export type SiteRead =
  | {
      kind: 'v2'
      revision: string
      document: CmsDocumentV2
      layout: DerivedCmsLayout
      warnings: string[]
    }
  /** Ainda não existe nenhum documento (nem v1 nem v2). */
  | { kind: 'none'; revision: string }
  /** Existe um rascunho no formato antigo; abrir como v2 exige conversão explícita, fora desta tela. */
  | { kind: 'v1'; revision: string }

/** Valida o envelope do snapshot e distingue ausente, v1 e v2. Lança se o payload não for confiável. */
export function readSiteSnapshot(value: unknown): SiteRead {
  const hasWarnings =
    typeof value === 'object' && value !== null && Object.hasOwn(value, 'warnings')
  const keys = hasWarnings
    ? ['schema', 'draft', 'published', 'warnings']
    : ['schema', 'draft', 'published']
  if (
    !exact(value, keys) ||
    !exact(value.draft, ['revision', 'document']) ||
    !cmsRevision(value.draft.revision) ||
    value.published !== null ||
    ('warnings' in value &&
      (!Array.isArray(value.warnings) || !value.warnings.every((w) => typeof w === 'string')))
  )
    throw new Error('INVALID_SITE')
  const revision = value.draft.revision
  if (value.schema === null && value.draft.document === null) return { kind: 'none', revision }
  if (
    value.schema === 1 &&
    typeof value.draft.document === 'object' &&
    value.draft.document !== null &&
    'schemaVersion' in value.draft.document &&
    value.draft.document.schemaVersion === 1
  )
    return { kind: 'v1', revision }
  if (value.schema !== 2 || !revision.startsWith('c2_')) throw new Error('INVALID_SITE')
  const parsed = parseCmsDocument(value.draft.document)
  if (parsed.value?.schemaVersion !== 2) throw new Error('INVALID_SITE')
  const layout = deriveLayout(parsed.value)
  if (layout.diagnostics.some((d) => d.severity === 'error')) throw new Error('INVALID_SITE')
  return {
    kind: 'v2',
    revision,
    document: parsed.value,
    layout,
    warnings: 'warnings' in value ? (value.warnings as string[]) : [],
  }
}

// ---------------------------------------------------------------------------------------------
// Rótulos e classificação de campos
// ---------------------------------------------------------------------------------------------

export const TEMPLATE_LABEL: Record<CmsTemplateV2, string> = {
  hero: 'Abertura',
  carousel: 'Vitrine de barris',
  ticker: 'Faixa de destaques',
  catalog: 'Catálogo',
  how: 'Como funciona',
  about: 'Sobre',
  highlight: 'Destaque',
  faq: 'Perguntas frequentes',
  contact: 'Contato',
}

export const NAVIGATION_LABEL = {
  none: 'Fora do menu',
  primary: 'No menu',
  cta: 'Botão de contato',
} as const

/**
 * Situação de um campo no contrato real:
 * - `editable`: o contrato aceita texto e uma etapa futura de edição poderá alterá-lo;
 * - `readonly`: definido por regra do código, derivado ou vindo de outro domínio (catálogo);
 * - `unavailable`: existe no contrato, mas não há como ver nem trocar o conteúdo ainda (mídia).
 */
export type FieldStatus = 'editable' | 'readonly' | 'unavailable'

export const STATUS_LABEL: Record<FieldStatus, string> = {
  editable: 'Editável depois',
  readonly: 'Somente leitura',
  unavailable: 'Indisponível',
}

export type FieldRow = {
  key: string
  label: string
  /** `null` = vazio/ausente; a tela mostra um texto próprio para isso. */
  value: string | null
  status: FieldStatus
  /** Texto de apoio (limite, de onde vem o valor, por que não é editável). */
  hint?: string
  /** Texto longo: preserva quebras de linha. */
  long?: boolean
  /** Linha de grupo (ex.: "Passos"): só rótulo. */
  group?: boolean
  /** 1 = pertence a um grupo. */
  depth?: 0 | 1
}

export type SectionSummary = {
  id: string
  template: CmsTemplateV2
  templateLabel: string
  title: string
  visible: boolean
  mandatory: boolean
  navigation: keyof typeof NAVIGATION_LABEL
  /** Âncora definida por regra (também para seção oculta). */
  anchor: string | null
  /** Posição entre as seções visíveis; `null` quando oculta. */
  position: number | null
  number: string | null
}

export type SectionDetail = SectionSummary & { structure: FieldRow[]; content: FieldRow[] }

const MANDATORY = new Set<CmsTemplateV2>(['hero', 'catalog', 'contact'])

const headingHint = `até ${CMS_LIMITS.heading} caracteres`
const textHint = `até ${CMS_LIMITS.text} caracteres`
const listHint = `até ${CMS_LIMITS.list} itens`

const text = (
  key: string,
  label: string,
  value: string,
  hint: string,
  long = false,
  depth: 0 | 1 = 0,
): FieldRow => ({
  key,
  label,
  value: value === '' ? null : value,
  status: 'editable',
  hint,
  long,
  depth,
})

const MEDIA_HINT = 'Sem envio de imagens nem resolução de arquivo nesta etapa.'
function mediaRow(
  key: string,
  label: string,
  ref: { id: string; alt: string } | null,
  depth: 0 | 1 = 0,
): FieldRow {
  return {
    key,
    label,
    value: ref === null ? null : `${ref.id}\nTexto alternativo: ${ref.alt}`,
    status: 'unavailable',
    hint: MEDIA_HINT,
    long: true,
    depth,
  }
}

const group = (key: string, label: string, hint: string): FieldRow => ({
  key,
  label,
  value: null,
  status: 'editable',
  hint,
  group: true,
})

function entryRows(entries: CmsCarouselEntry[]): FieldRow[] {
  return entries.flatMap((entry, index): FieldRow[] => [
    {
      key: `entries.${index}.itemId`,
      label: `Barril ${index + 1}`,
      value: entry.itemId,
      status: 'readonly',
      hint: 'Vem do catálogo; só a ordem e a seleção são editoriais.',
      depth: 1,
    },
    ...(entry.media === null
      ? []
      : [mediaRow(`entries.${index}.media`, `Imagem do barril ${index + 1}`, entry.media, 1)]),
  ])
}

function contentRows(module: CmsModuleV2): FieldRow[] {
  switch (module.template) {
    case 'hero':
      return [
        text('heading', 'Título', module.content.heading, headingHint),
        text('summary', 'Resumo', module.content.summary, textHint, true),
        mediaRow('media', 'Imagem', module.content.media),
      ]
    case 'carousel':
      return [
        text('heading', 'Título', module.content.heading, headingHint),
        text('lead', 'Texto de apoio', module.content.lead, textHint, true),
        mediaRow('media', 'Imagem', module.content.media),
        group(
          'entries',
          `Barris da vitrine (${module.content.entries.length} de ${CMS_LIMITS.list})`,
          listHint,
        ),
        ...entryRows(module.content.entries),
      ]
    case 'ticker':
      return [
        group(
          'items',
          `Frases da faixa (${module.content.items.length} de ${CMS_LIMITS.list})`,
          listHint,
        ),
        ...module.content.items.map((item, index) =>
          text(`items.${index}`, `Frase ${index + 1}`, item, headingHint, false, 1),
        ),
      ]
    case 'catalog':
      return [
        text('heading', 'Título', module.content.heading, headingHint),
        text('intro', 'Introdução', module.content.intro, textHint, true),
        {
          key: 'prices',
          label: 'Preços, volumes e variantes',
          value: 'Gerenciados na tela Produtos',
          status: 'readonly',
          hint: 'Não fazem parte do documento da página inicial.',
        },
      ]
    case 'how':
      return [
        text('heading', 'Título', module.content.heading, headingHint),
        group('steps', `Passos (${module.content.steps.length} de ${CMS_LIMITS.list})`, listHint),
        ...module.content.steps.flatMap((step, index) => [
          text(
            `steps.${index}.title`,
            `Passo ${index + 1} · título`,
            step.title,
            headingHint,
            false,
            1,
          ),
          text(`steps.${index}.body`, `Passo ${index + 1} · texto`, step.body, textHint, true, 1),
        ]),
      ]
    case 'about':
    case 'highlight':
      return [
        text('heading', 'Título', module.content.heading, headingHint),
        text('body', 'Texto', module.content.body, textHint, true),
        mediaRow('media', 'Imagem', module.content.media),
      ]
    case 'faq':
      return [
        text('heading', 'Título', module.content.heading, headingHint),
        group(
          'items',
          `Perguntas (${module.content.items.length} de ${CMS_LIMITS.list})`,
          listHint,
        ),
        ...module.content.items.flatMap((item, index) => [
          text(
            `items.${index}.question`,
            `Pergunta ${index + 1}`,
            item.question,
            headingHint,
            false,
            1,
          ),
          text(`items.${index}.answer`, `Resposta ${index + 1}`, item.answer, textHint, true, 1),
        ]),
      ]
    case 'contact':
      return [
        text('heading', 'Título', module.content.heading, headingHint),
        text('body', 'Texto', module.content.body, textHint, true),
      ]
  }
}

function titleOf(module: CmsModuleV2): string {
  const content = module.content as { heading?: unknown }
  return typeof content.heading === 'string' && content.heading.trim() !== ''
    ? content.heading
    : TEMPLATE_LABEL[module.template]
}

/** Resumo de cada seção, na ordem do documento (ordem editorial preservada, ocultas incluídas). */
export function summarizeSections(
  document: CmsDocumentV2,
  layout: DerivedCmsLayout,
): SectionSummary[] {
  const derived = new Map(layout.sections.map((s) => [s.id, s]))
  return document.modules.map((module) => {
    const section = derived.get(module.id)
    return {
      id: module.id,
      template: module.template,
      templateLabel: TEMPLATE_LABEL[module.template],
      title: titleOf(module),
      visible: module.visible,
      mandatory: MANDATORY.has(module.template),
      navigation: module.navigation,
      anchor: CMS_RULES_V2[module.template].anchor,
      position: section?.position ?? null,
      number: section?.number ?? null,
    }
  })
}

/** Detalhe de uma seção: estrutura (definida por regra) e conteúdo editorial, cada linha com sua situação. */
export function describeSection(
  document: CmsDocumentV2,
  layout: DerivedCmsLayout,
  id: string,
): SectionDetail | null {
  const module = document.modules.find((m) => m.id === id)
  if (!module) return null
  const summary = summarizeSections(document, layout).find((s) => s.id === id)
  if (!summary) return null
  const placement = summary.visible
    ? `${summary.position}ª seção da página${summary.number ? ` · numeração ${summary.number}` : ''}`
    : 'Fora da página (oculta)'
  const structure: FieldRow[] = [
    {
      key: 'id',
      label: 'Identificador',
      value: summary.id,
      status: 'readonly',
      hint: summary.mandatory
        ? 'Fixo: seção obrigatória do site.'
        : 'Gerado pelo CMS ao criar a seção.',
    },
    { key: 'template', label: 'Tipo de seção', value: summary.templateLabel, status: 'readonly' },
    {
      key: 'visible',
      label: 'Visibilidade',
      value: summary.visible ? 'Visível no site' : 'Oculta',
      status: summary.mandatory ? 'readonly' : 'editable',
      hint: summary.mandatory ? 'Obrigatória: precisa estar sempre visível.' : undefined,
    },
    {
      key: 'navigation',
      label: 'Navegação',
      value: NAVIGATION_LABEL[summary.navigation],
      status: 'readonly',
      hint: 'Definida por regra do site, não por texto editorial.',
    },
    {
      key: 'anchor',
      label: 'Âncora',
      value: summary.anchor === null ? null : `#${summary.anchor}`,
      status: 'readonly',
      hint: 'Definida por regra do site.',
    },
    {
      key: 'placement',
      label: 'Posição',
      value: placement,
      status: 'readonly',
      hint: 'Derivada da ordem do documento.',
    },
  ]
  return { ...summary, structure, content: contentRows(module) }
}

export type DocumentRow = FieldRow

/** Dados do documento como um todo (fora das seções). */
export function describeDocument(read: Extract<SiteRead, { kind: 'v2' }>): DocumentRow[] {
  const { document, revision } = read
  const total = document.modules.length
  const visible = document.modules.filter((m) => m.visible).length
  return [
    { key: 'revision', label: 'Revisão do rascunho', value: revision, status: 'readonly' },
    {
      key: 'publication',
      label: 'Publicação',
      value: 'Desativada. Nada deste documento está publicado.',
      status: 'readonly',
      hint: 'A homepage pública ainda não lê este documento.',
    },
    {
      key: 'sections',
      label: 'Seções',
      value: `${total} no documento, ${visible} visíveis`,
      status: 'readonly',
    },
    {
      key: 'fulfillment',
      label: 'Modo de atendimento',
      value: 'Entrega',
      status: 'readonly',
      hint: 'Fixo pelo contrato: o site só vende por delivery.',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp comercial',
      value: document.commercial.whatsappNumber,
      status: 'readonly',
      hint: 'Ainda não é consumido: o site usa o número configurado no build.',
    },
  ]
}

const DIAGNOSTIC_TEXT: Record<string, string> = {
  COMPOSITION_WITHOUT_CAROUSEL: 'O documento não tem a vitrine de barris.',
  CAROUSEL_HIDDEN: 'A vitrine de barris está oculta.',
  CAROUSEL_EMPTY: 'A vitrine de barris não tem barris selecionados.',
  MEDIA_NOT_READY: 'Há imagem referenciada que ainda não está pronta para uso.',
}

/** Avisos do documento em texto claro (códigos desconhecidos aparecem como estão, sem esconder nada). */
export function documentNotices(read: Extract<SiteRead, { kind: 'v2' }>): string[] {
  const fromLayout = read.layout.diagnostics.map((d) => DIAGNOSTIC_TEXT[d.code] ?? d.code)
  const fromServer = read.warnings.map((w) => DIAGNOSTIC_TEXT[w] ?? w)
  return [...new Set([...fromLayout, ...fromServer])]
}

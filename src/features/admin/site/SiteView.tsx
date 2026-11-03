import { useId, useRef, useState } from 'react'
import { AdminButton } from '../ui/AdminButton'
import styles from './SiteView.module.css'
import {
  describeDocument,
  describeSection,
  documentNotices,
  type FieldRow,
  NAVIGATION_LABEL,
  type SectionSummary,
  type SiteRead,
  STATUS_LABEL,
  summarizeSections,
} from './siteModel'
import { type SiteState, useSiteDocument } from './useSiteDocument'

const emptyText = (row: FieldRow) =>
  row.key.endsWith('media')
    ? 'Sem imagem'
    : row.key === 'anchor'
      ? 'Sem âncora'
      : row.key === 'whatsapp'
        ? 'Não definido'
        : 'Vazio'

/** Linhas de campos: cada uma diz se o campo é editável no futuro, somente leitura ou indisponível. */
function Rows({ rows, label }: { rows: FieldRow[]; label: string }) {
  return (
    <dl className={styles.rows} aria-label={label}>
      {rows.map((row) => (
        <div
          key={row.key}
          className={row.group ? styles.groupRow : styles.row}
          data-depth={row.depth ?? 0}
          data-status={row.status}
        >
          <dt className={styles.term}>
            <span>{row.label}</span>
            {row.group ? null : (
              <span className={`${styles.status} ${styles[row.status]}`}>
                {STATUS_LABEL[row.status]}
              </span>
            )}
          </dt>
          <dd className={styles.value}>
            {row.group ? null : row.value === null ? (
              <span className={styles.empty}>{emptyText(row)}</span>
            ) : (
              <span className={row.long ? styles.long : undefined}>{row.value}</span>
            )}
            {row.hint ? <small className={styles.hint}>{row.hint}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Tipo e âncora; o tipo some quando já é o próprio título (ex.: a faixa, que não tem título). */
const metaOf = (section: SectionSummary) =>
  [
    section.title === section.templateLabel ? null : section.templateLabel,
    section.anchor ? `#${section.anchor}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

function SectionItem({
  section,
  selected,
  onSelect,
}: {
  section: SectionSummary
  selected: boolean
  onSelect: () => void
}) {
  const meta = metaOf(section)
  return (
    <li>
      <button
        type="button"
        className={styles.item}
        aria-current={selected ? 'true' : undefined}
        data-hidden={!section.visible}
        onClick={onSelect}
      >
        <span className={styles.position} aria-hidden="true">
          {section.position ?? '–'}
        </span>
        <span className={styles.itemText}>
          <span className={styles.itemTitle}>{section.title}</span>
          {meta ? <span className={styles.itemMeta}>{meta}</span> : null}
        </span>
        <span className={styles.itemFlags}>
          {section.visible ? null : <span className={styles.flagWarn}>Oculta</span>}
          {section.mandatory ? <span className={styles.flag}>Obrigatória</span> : null}
          {section.navigation === 'none' ? null : (
            <span className={styles.flag}>{NAVIGATION_LABEL[section.navigation]}</span>
          )}
        </span>
      </button>
    </li>
  )
}

function Document({ read }: { read: Extract<SiteRead, { kind: 'v2' }> }) {
  const sections = summarizeSections(read.document, read.layout)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = sections.find((s) => s.id === selectedId) ?? sections[0]
  const detail = selected ? describeSection(read.document, read.layout, selected.id) : null
  const detailRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const notices = documentNotices(read)
  const visibleCount = sections.filter((s) => s.visible).length

  const select = (id: string) => {
    setSelectedId(id)
    // Em tela estreita o detalhe fica abaixo da lista: leva o olhar até ele.
    if (window.matchMedia('(max-width: 63.99rem)').matches)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        }),
      )
  }

  return (
    <>
      <ul className={styles.chips} aria-label="Resumo do documento">
        <li className={styles.chip}>
          {sections.length} {sections.length === 1 ? 'seção' : 'seções'}
        </li>
        <li className={styles.chip}>
          {visibleCount} {visibleCount === 1 ? 'visível' : 'visíveis'}
        </li>
        <li className={`${styles.chip} ${styles.chipInfo}`}>
          Revisão {read.revision.slice(0, 11)}…
        </li>
      </ul>

      {notices.length > 0 ? (
        <div className={styles.notices} role="status">
          <p className={styles.noticesTitle}>Avisos do documento</p>
          <ul>
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className={styles.documentInfo}>
        <summary>Documento e dados comerciais</summary>
        <Rows rows={describeDocument(read)} label="Dados do documento" />
      </details>

      <div className={styles.split}>
        <nav aria-label="Seções da página inicial" className={styles.sections}>
          <ol className={styles.list}>
            {sections.map((section) => (
              <SectionItem
                key={section.id}
                section={section}
                selected={section.id === selected?.id}
                onSelect={() => select(section.id)}
              />
            ))}
          </ol>
        </nav>

        {detail ? (
          <section ref={detailRef} className={styles.detail} aria-labelledby={titleId}>
            <header className={styles.detailHead}>
              <p className={styles.detailKind}>
                {detail.templateLabel}
                {detail.number ? ` · seção ${detail.number}` : ''}
              </p>
              <h2 id={titleId} className={styles.detailTitle}>
                {detail.title}
              </h2>
            </header>
            <h3 className={styles.groupTitle}>Estrutura</h3>
            <Rows rows={detail.structure} label={`Estrutura de ${detail.title}`} />
            <h3 className={styles.groupTitle}>Conteúdo</h3>
            <Rows rows={detail.content} label={`Conteúdo de ${detail.title}`} />
          </section>
        ) : null}
      </div>
    </>
  )
}

const MESSAGES = {
  none: {
    title: 'Ainda não há documento da página inicial',
    text: 'O CMS não tem nenhum rascunho editorial. Esta tela só consulta: ela não cria nem inicializa documentos. A inicialização do CMS v2 fica para uma etapa própria.',
  },
  v1: {
    title: 'O rascunho está no formato antigo (v1)',
    text: 'Para ver as seções aqui, o documento precisa ser convertido para o v2. A conversão exige confirmação explícita e não é feita por esta tela.',
  },
  forbidden: {
    title: 'Sem permissão para ver a página inicial',
    text: 'Sua sessão está ativa, mas esta conta não pode consultar o rascunho. Fale com quem administra o painel.',
  },
  unavailable: {
    title: 'O CMS está indisponível no momento',
    text: 'O servidor respondeu que o CMS não está disponível. O catálogo continua funcionando. Tente de novo em instantes.',
  },
  error: {
    title: 'Não conseguimos carregar a página inicial',
    text: 'Nada foi alterado. Tente de novo em instantes.',
  },
} as const

function Body({ state, retry }: { state: SiteState; retry: () => void }) {
  if (state.status === 'loading')
    return (
      <div role="status" aria-label="Carregando a página inicial">
        <div className={styles.skeleton} aria-hidden="true">
          <span className={styles.skeletonBlock} />
          <span className={styles.skeletonBlock} />
          <span className={styles.skeletonBlock} />
        </div>
      </div>
    )
  if (state.status === 'expired')
    return (
      <p role="status" className={styles.message}>
        Sessão expirada. Voltando ao login…
      </p>
    )
  if (state.status === 'ready' && state.read.kind === 'v2') return <Document read={state.read} />

  const key = state.status === 'ready' ? state.read.kind : state.status
  const message = MESSAGES[key as keyof typeof MESSAGES]
  const failed = state.status === 'error' || state.status === 'unavailable'
  return (
    <section className={styles.message} role={failed ? 'alert' : 'status'}>
      <h2 className={styles.messageTitle}>{message.title}</h2>
      <p className={styles.messageText}>{message.text}</p>
      {failed ? (
        <div className={styles.messageActions}>
          <AdminButton onClick={retry}>Tentar de novo</AdminButton>
        </div>
      ) : null}
    </section>
  )
}

/** Tela "Página inicial" do painel: consulta o documento editorial do CMS v2, sem editar nada. */
export function SiteView({ onExpired }: { onExpired: () => void }) {
  const { state, reload } = useSiteDocument(onExpired)
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>Somente leitura</p>
            <h1 className={styles.title}>Página inicial</h1>
          </div>
          <div className={styles.actions}>
            <a
              className={styles.link}
              href="/admin/preview"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir prévia
            </a>
            <AdminButton variant="outline" onClick={reload} disabled={state.status === 'loading'}>
              Atualizar
            </AdminButton>
          </div>
        </div>
        <p className={styles.notice}>
          Rascunho do CMS v2, não publicado. Esta tela só consulta: nada é salvo, convertido ou
          publicado.
        </p>
        <Body state={state} retry={reload} />
      </div>
    </div>
  )
}

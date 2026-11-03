import styles from './Preview.module.css'
import type { PreviewState } from './usePreviewDocument'
export function PreviewMessage({
  state,
  retry,
}: {
  state: Exclude<PreviewState, { status: 'ready' }>
  retry: () => void
}) {
  if (state.status === 'loading')
    return (
      <p role="status" className={styles.message}>
        Carregando rascunho autenticado…
      </p>
    )
  if (state.status === 'missing')
    return (
      <section className={styles.message}>
        <h2>Documento CMS v2 necessário</h2>
        <p>
          Converta explicitamente o rascunho v1 ou inicialize um documento v2 no fluxo
          administrativo autorizado. Esta prévia não realiza conversão nem inicialização.
        </p>
      </section>
    )
  if (state.status === 'expired')
    return (
      <section role="alert" className={styles.message}>
        <h2>Sessão expirada</h2>
        <p>O conteúdo foi removido da prévia.</p>
        <a href="/admin">Entrar no painel</a>
      </section>
    )
  return (
    <section role="alert" className={styles.message}>
      <h2>Prévia indisponível</h2>
      <p>Não foi possível obter um documento CMS v2 válido. Nenhum conteúdo foi renderizado.</p>
      <button type="button" onClick={retry}>
        Tentar novamente
      </button>
    </section>
  )
}

import { useCatalog } from '../../catalog/useCatalog'
import styles from './Preview.module.css'
import { PreviewMessage } from './PreviewMessage'
import { PreviewRenderer } from './PreviewRenderer'
import { usePreviewDocument } from './usePreviewDocument'

export default function PreviewFrame() {
  const { state, reload } = usePreviewDocument()
  const catalog = useCatalog()
  if (state.status !== 'ready') return <PreviewMessage state={state} retry={reload} />
  return (
    <>
      <p role="note" className={styles.frameNotice}>
        Prévia privada · Rascunho não publicado · Ações comerciais desativadas
      </p>
      <PreviewRenderer value={state.value} catalog={catalog.state} retry={catalog.retry} />
    </>
  )
}

import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './Ticker.module.css'

const phrases = [
  'Chope gelado',
  'Barril 30 L',
  'Barril 50 L',
  '100% Delivery',
  'Instalação inclusa',
]

/** Cada metade da pista precisa cobrir a tela toda; as cópias extras são só decorativas. */
const COPIES = 5

function Row({ hidden, items }: { hidden?: boolean; items: string[] }) {
  const occurrences = new Map<string, number>()
  return (
    <ul className={styles.row} aria-hidden={hidden || undefined}>
      {Array.from({ length: COPIES }, (_, copy) => copy).flatMap((copy) =>
        items.map((phrase) => {
          const occurrence = (occurrences.get(phrase) ?? 0) + 1
          occurrences.set(phrase, occurrence)
          return (
            <li
              key={`${phrase}-${occurrence}`}
              className={styles.item}
              aria-hidden={copy > 0 || undefined}
            >
              {phrase}
            </li>
          )
        }),
      )}
    </ul>
  )
}

/** Faixa dourada decorativa. Para quando o sistema pede menos movimento. */
export function Ticker({ editorial }: { editorial?: CmsContentsV2['ticker'] } = {}) {
  return (
    <div className={styles.ticker}>
      <div className={styles.track}>
        <Row items={editorial?.items ?? phrases} />
        <Row hidden items={editorial?.items ?? phrases} />
      </div>
    </div>
  )
}

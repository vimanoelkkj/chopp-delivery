import styles from './Ticker.module.css'

const phrases = ['Chope gelado', 'Barril 30 L', 'Barril 50 L', 'Delivery', 'Retirada']

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul className={styles.row} aria-hidden={hidden || undefined}>
      {phrases.map((phrase) => (
        <li key={phrase} className={styles.item}>
          {phrase}
        </li>
      ))}
    </ul>
  )
}

/** Faixa dourada decorativa. Para quando o sistema pede menos movimento. */
export function Ticker() {
  return (
    <div className={styles.ticker}>
      <div className={styles.track}>
        <Row />
        <Row hidden />
      </div>
    </div>
  )
}

import styles from './DesktopBreak.module.css'

/** Quebra de linha que só existe no desktop. No celular o título corre em uma linha só. */
export function DesktopBreak() {
  return (
    <>
      {' '}
      <br className={styles.break} />
    </>
  )
}

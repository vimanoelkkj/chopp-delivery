import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

type Variant = 'gold' | 'outline' | 'dark'
type Size = 'md' | 'lg'

type CommonProps = {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  children: ReactNode
}

type AnchorProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
type NativeButtonProps = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined }

export type ButtonProps = AnchorProps | NativeButtonProps

/** Botão ou link com a aparência de botão. Com `href` vira <a>; sem, vira <button>. */
export function Button(props: ButtonProps) {
  const { variant = 'gold', size = 'md', fullWidth, className, children, ...rest } = props
  const classes = [
    styles.button,
    styles[variant],
    size === 'lg' ? styles.lg : '',
    fullWidth ? styles.full : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  if ('href' in rest && rest.href !== undefined) {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} className={classes}>
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      className={classes}
    >
      {children}
    </button>
  )
}

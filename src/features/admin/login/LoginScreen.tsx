import { type FormEvent, useId, useRef, useState } from 'react'
import seal from '@/assets/admin-seal.png'
import type { AdminUser } from '../catalog/types'
import { type LoginFailure, login } from '../session/authApi'
import { AdminButton } from '../ui/AdminButton'
import styles from './LoginScreen.module.css'

type LoginScreenProps = { notice?: string; onSignedIn: (user: AdminUser) => void }

function waitText(seconds: number | null): string {
  if (seconds === null) return 'alguns minutos'
  const minutes = Math.ceil(seconds / 60)
  return minutes <= 1 ? '1 minuto' : `${minutes} minutos`
}

export function failureMessage(failure: LoginFailure): string {
  switch (failure.reason) {
    case 'invalid-credentials':
      return 'Usuário ou senha incorretos.'
    case 'rate-limited':
      return `Muitas tentativas. Tente de novo em ${waitText(failure.retryAfterSeconds)}.`
    case 'bad-origin':
      return 'Este endereço não pode entrar no painel. Use o endereço oficial do painel.'
    case 'bad-request':
      return 'Confira o usuário e a senha e tente de novo.'
    default:
      return 'Não foi possível entrar agora. Tente de novo em instantes.'
  }
}

export function LoginScreen({ notice, onSignedIn }: LoginScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ id: number; message: string } | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const ids = { user: useId(), password: useId(), error: useId() }

  const fail = (message: string) => {
    setError((current) => ({ id: (current?.id ?? 0) + 1, message }))
    passwordRef.current?.focus()
    passwordRef.current?.select()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    if (!username.trim() || !password) {
      fail('Informe o usuário e a senha.')
      return
    }
    setPending(true)
    setError(null)
    const result = await login(username.trim(), password)
    setPending(false)
    if (result.ok) onSignedIn(result.user)
    else fail(failureMessage(result))
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <img className={styles.seal} src={seal} width="88" height="88" alt="" />
        <p className={styles.eyebrow}>Acesso restrito</p>
        <h1 className={styles.title}>
          Painel <span>Delegas</span>
        </h1>
        {notice ? <p className={styles.notice}>{notice}</p> : null}
        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.field}>
            <label htmlFor={ids.user} className={styles.label}>
              Usuário
            </label>
            <input
              id={ids.user}
              className={styles.input}
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.error : undefined}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={ids.password} className={styles.label}>
              Senha
            </label>
            <div className={styles.passwordRow}>
              <input
                id={ids.password}
                ref={passwordRef}
                className={styles.input}
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? ids.error : undefined}
              />
              <button
                type="button"
                className={styles.toggle}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>
          {error ? (
            <p key={error.id} id={ids.error} className={styles.error} role="alert">
              {error.message}
            </p>
          ) : null}
          <AdminButton type="submit" pending={pending} className={styles.submit}>
            {pending ? 'Entrando…' : 'Entrar'}
          </AdminButton>
        </form>
        <a className={styles.back} href="/">
          Voltar ao site
        </a>
      </div>
    </main>
  )
}

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { initials, playerColour } from '../lib/format'

type Variant = 'primary' | 'party' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'primary',
  size,
  block,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm'; block?: boolean }) {
  const cls = ['btn', `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', className]
    .filter(Boolean)
    .join(' ')
  return <button className={cls} {...rest} />
}

export function Card({
  title,
  action,
  highlight,
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  highlight?: boolean
  children: ReactNode
}) {
  return (
    <section className={highlight ? 'card card--highlight' : 'card'}>
      {title && (
        <div className="card__title">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Badge({
  tone,
  children,
}: {
  tone?: 'pink' | 'cyan' | 'lime' | 'gold' | 'purple'
  children: ReactNode
}) {
  return <span className={tone ? `badge badge--${tone}` : 'badge'}>{children}</span>
}

export function Field({
  label,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" {...input} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <span className="avatar" style={{ background: playerColour(id), width: size, height: size }} aria-hidden>
      {initials(name)}
    </span>
  )
}

export function Rank({ n }: { n: number }) {
  return <span className={n <= 3 ? `rank rank--${n}` : 'rank'}>{n}</span>
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function Empty({ icon = '🎲', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      {children}
    </div>
  )
}

export function Loading() {
  return (
    <div className="center-screen">
      <div className="spinner" role="status" aria-label="Loading" />
    </div>
  )
}

export function Alert({ tone, children }: { tone?: 'error' | 'success'; children: ReactNode }) {
  return <div className={tone ? `alert alert--${tone}` : 'alert'}>{children}</div>
}

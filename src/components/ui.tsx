import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import type { DeliveryStatus, DocumentStatus, OfferStatus, PartnerAvailability } from '../domain/model'

export type IconName = 'overview' | 'deliveries' | 'partners' | 'applications' | 'kyc' | 'notifications' | 'audit' | 'settings' | 'search' | 'plus' | 'chevron' | 'arrow' | 'clock' | 'pin' | 'filter' | 'sort' | 'more' | 'close' | 'check' | 'alert' | 'calendar' | 'bike' | 'scooter' | 'van' | 'menu' | 'refresh' | 'file' | 'user' | 'shield' | 'route' | 'truck' | 'check-circle' | 'external' | 'lock' | 'home' | 'download' | 'eye' | 'edit' | 'logout' | 'sparkle' | 'info' | 'locate'

const iconPaths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/></>,
  deliveries: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></>,
  partners: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.2a4 4 0 0 1 0 7.6"/></>,
  applications: <><path d="M6 4h12l2 9v7H4v-7l2-9Z"/><path d="M4 13h4l2 3h4l2-3h4"/><path d="M9 8h6"/></>,
  kyc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m8.5 14.5 2 2 4-4"/></>,
  notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  audit: <><path d="M8 5H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M8 3h8v5H8zM7 12h7m-7 4h6"/><circle cx="18" cy="10" r="4"/><path d="m21 13 2 2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.1.9-1.1 1.9-1.4-.5a8 8 0 0 1-1.6.9l-.3 1.5H14l-.3-1.5a8 8 0 0 1-1.7-.9l-1.4.5-1.1-1.9 1.1-.9a7 7 0 0 1 0-1.9l-1.1-.9 1.1-1.9 1.4.5a8 8 0 0 1 1.7-.9l.3-1.5h2.2l.3 1.5a8 8 0 0 1 1.6.9l1.4-.5 1.1 1.9-1.1.9a7 7 0 0 1-.1 1.8Z" transform="translate(-1 -1) scale(1.08)"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  filter: <><path d="M4 7h16M7 12h10m-7 5h4"/></>,
  sort: <><path d="M8 6h12M8 12h8M8 18h4M4 5v14m0 0-2-2m2 2 2-2"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  close: <path d="m18 6-12 12M6 6l12 12"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  alert: <><path d="M10.3 3.9 2.5 17.4A1.8 1.8 0 0 0 4.1 20h15.8a1.8 1.8 0 0 0 1.6-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3h.01"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  bike: <><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="m8 17 4-8h4m-7 0h3l3 8m-3-8-2-3H7"/></>,
  scooter: <><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 18h9l-2-7h4l2 7M13 11l-2-3H8"/></>,
  van: <><path d="M3 7h11v11H3zM14 11h4l3 3v4h-7z"/><circle cx="7" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h8"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
  route: <><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h4a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4"/></>,
  truck: <><path d="M3 7h11v11H3zM14 11h4l3 3v4h-7z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/></>,
  'check-circle': <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  external: <><path d="M14 3h7v7m0-7-9 9"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
  edit: <><path d="m16 4 4 4L9 19l-5 1 1-5L16 4Z"/><path d="m14 6 4 4"/></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
  sparkle: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  locate: <><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>,
}

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
}

export function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M19.7 4.8c2.8-2.7 7.4-2.7 10.2 0l4.8 4.7a7.2 7.2 0 0 1 0 10.3l-6.1 6.1-14.9-14.8 6-6.3Z" fill="#b994f2"/><path d="M10.5 13.5a7.2 7.2 0 0 1 10.2 0l14.1 14-5.2 5.2a7.2 7.2 0 0 1-10.2 0L4.9 18.3l5.6-4.8Z" fill="#713CE0"/><path d="m8 21.3 14.4-14" stroke="#e3d0ff" strokeWidth="2.2" strokeLinecap="round"/></svg>
}

export function StatusBadge({ status }: { status: DeliveryStatus | PartnerAvailability | DocumentStatus | OfferStatus | 'Eligible' | 'Ineligible' | string }) {
  const key = status.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z-]/g, '')
  return <span className={`status-badge status-${key}`}><i className="status-dot" />{status}</span>
}

export function PageHeading({ title, subtitle, breadcrumbs, action, onNavigate }: { title: string; subtitle: string; breadcrumbs?: Array<{ label: string; path?: string }>; action?: ReactNode; onNavigate?: (path: string) => void }) {
  const backCrumb = breadcrumbs && onNavigate ? [...breadcrumbs].reverse().find((crumb) => crumb.path) : undefined
  return <div className="page-heading">
    <div>
      {(backCrumb || breadcrumbs) && <div className="heading-meta">
        {backCrumb && <button className="heading-back" onClick={() => onNavigate?.(backCrumb.path!)} aria-label={`Back to ${backCrumb.label}`}><Icon name="arrow" size={13} className="icon-flip" /><span>Back to {backCrumb.label}</span></button>}
        {breadcrumbs && <div className="breadcrumbs">{breadcrumbs.map((crumb, index) => <span key={`${crumb.label}-${index}`}>{index > 0 && <Icon name="chevron" size={13} />}{crumb.path && onNavigate ? <button onClick={() => onNavigate(crumb.path!)}>{crumb.label}</button> : <span>{crumb.label}</span>}</span>)}</div>}
      </div>}
      <div className="title-row"><h1>{title}</h1></div>
      <p className="page-subtitle">{subtitle}</p>
    </div>
    {action && <div className="heading-action">{action}</div>}
  </div>
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`panel ${className}`}>{children}</section>
}

export function PanelHeading({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>
}

export function Button({ children, variant = 'secondary', size = 'normal', className = '', disabled, type = 'button', title, onClick }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'normal' | 'small'; className?: string; disabled?: boolean; type?: 'button' | 'submit'; title?: string; onClick?: () => void }) {
  return <button className={`button button-${variant} button-${size} ${className}`} disabled={disabled} type={type} title={title} onClick={onClick}>{children}</button>
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="sparkle" size={20} /></span><strong>{title}</strong><p>{detail}</p>{action}</div>
}

export function Dialog({ title, eyebrow = 'OPERATIONS WORKFLOW', children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? [])
    const preferred = dialogRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')
    ;(preferred ?? focusable()[0])?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="dialog-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </section>
  </div>
}

export function ConfirmDialog({ title, detail, reasonLabel = 'Reason', confirmLabel = 'Confirm', danger = false, onCancel, onConfirm }: { title: string; detail: string; reasonLabel?: string; confirmLabel?: string; danger?: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onConfirm(String(form.get('reason') ?? '').trim())
  }
  return <Dialog title={title} onClose={onCancel}>
    <form className="dialog-form" onSubmit={submit}>
      <p className="dialog-description">{detail}</p>
      <label className="field-label">{reasonLabel}<textarea name="reason" rows={3} required maxLength={240} placeholder="Add a concise operational note" /></label>
      <div className="dialog-actions"><Button onClick={onCancel}>Go back</Button><Button type="submit" variant={danger ? 'danger' : 'primary'}>{confirmLabel}</Button></div>
    </form>
  </Dialog>
}

export { safeExternalUrl } from '../utils/url'

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, options).format(date)
}

export function relativeTime(value: string) {
  const delta = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (delta === 0) return 'just now'
  if (delta < -60) return `${Math.abs(Math.floor(delta / 60))}h ago`
  if (delta < 0) return `${Math.abs(delta)}m ago`
  if (delta < 60) return `in ${delta}m`
  return `in ${Math.floor(delta / 60)}h`
}

export function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part.replace(/[^a-z]/gi, '')[0] ?? '').join('').toUpperCase()
}

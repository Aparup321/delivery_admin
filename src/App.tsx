import { useEffect, useMemo, useState } from 'react'
import { Button, BrandMark, Icon, PageHeading, initials } from './components/ui'
import { AdminAccountDialog } from './components/AdminAccountDialog'
import { clearAdminSession, readAdminSession, type AdminSession } from './auth/adminSession'
import { useOperations } from './state/OperationsProvider'
import { OverviewPage } from './pages/OverviewPage'
import { DeliveriesPage } from './pages/DeliveriesPage'
import { DeliveryDetailPage } from './pages/DeliveryDetailPage'
import { AssignmentPage } from './pages/AssignmentPage'
import { AdminLoginPage } from './pages/LoginPage'
import { PartnerProfilePage, PartnersPage } from './pages/PartnersPage'
import { KycReviewPage } from './pages/KycReviewPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { AuditLogsPage } from './pages/AuditLogsPage'
import { SettingsPage } from './pages/SettingsPage'

interface RouteState {
  pathname: string
  search: string
}

function currentRoute(): RouteState {
  return { pathname: window.location.pathname.replace(/\/$/, '') || '/admin', search: window.location.search }
}

function routeLabel(pathname: string) {
  if (pathname === '/admin' || pathname === '') return 'Overview'
  if (pathname.startsWith('/admin/deliveries/')) return 'Deliveries'
  if (pathname.startsWith('/admin/partners/')) return 'Partners'
  if (pathname === '/admin/deliveries') return 'Deliveries'
  if (pathname === '/admin/partners') return 'Partners'
  if (pathname === '/admin/kyc') return 'KYC Review'
  if (pathname === '/admin/notifications') return 'Notifications'
  if (pathname === '/admin/audit-logs') return 'Audit Logs'
  if (pathname === '/admin/settings') return 'Settings'
  return 'Overview'
}

const navItems = [
  { label: 'Overview', path: '/admin', icon: 'overview' as const },
  { label: 'Deliveries', path: '/admin/deliveries', icon: 'deliveries' as const },
  { label: 'Partners', path: '/admin/partners', icon: 'partners' as const },
  { label: 'KYC Review', path: '/admin/kyc', icon: 'kyc' as const },
  { label: 'Notifications', path: '/admin/notifications', icon: 'notifications' as const },
  { label: 'Audit Logs', path: '/admin/audit-logs', icon: 'audit' as const },
  { label: 'Settings', path: '/admin/settings', icon: 'settings' as const },
]

function isActive(pathname: string, path: string) {
  if (path === '/admin') return pathname === '/admin'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(() => readAdminSession())
  if (!session) return <AdminLoginPage onSignedIn={setSession} />
  return <AdminWorkspace session={session} onSignedOut={() => setSession(null)} />
}

function AdminWorkspace({ session, onSignedOut }: { session: AdminSession; onSignedOut: () => void }) {
  const { frame, storageAvailable } = useOperations()
  const [route, setRoute] = useState<RouteState>(() => currentRoute())
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<{ message: string; kind: string } | null>(null)
  const legacyKycRoute = route.pathname === '/admin/applications'
    || (route.pathname === '/admin/partners' && ['kyc', 'applications'].includes(new URLSearchParams(route.search).get('view') ?? ''))
  const routePath = legacyKycRoute ? '/admin/kyc' : route.pathname
  const activeLabel = routeLabel(routePath)
  const unreadCount = frame.data.notifications.filter((notification) => !notification.readAt).length

  useEffect(() => {
    const onPopState = () => {
      const dirty = window.sessionStorage.getItem('picdrop-demo-settings-dirty') === '1'
      const previous = `${route.pathname}${route.search}`
      if (dirty && !window.confirm('You have unsaved demo settings. Leave this page and discard those edits?')) {
        window.history.pushState({}, '', previous)
        return
      }
      window.sessionStorage.removeItem('picdrop-demo-settings-dirty')
      setRoute(currentRoute())
      setMobileNavOpen(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [route])

  useEffect(() => {
    if (!frame.feedback) return
    setToast({ message: frame.feedback.message, kind: frame.feedback.kind })
    const timer = window.setTimeout(() => setToast(null), frame.feedback?.kind === 'error' ? 5200 : 3400)
    return () => window.clearTimeout(timer)
  }, [frame.feedback])

  useEffect(() => {
    if (!toast) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setToast(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toast])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.global-search input')?.focus()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  function open(path: string) {
    const dirty = window.sessionStorage.getItem('picdrop-demo-settings-dirty') === '1'
    const target = new URL(path, window.location.origin)
    const current = `${route.pathname}${route.search}`
    const next = `${target.pathname}${target.search}`
    if (next === current) return
    if (dirty && route.pathname === '/admin/settings' && !window.confirm('You have unsaved demo settings. Leave this page and discard those edits?')) return
    if (dirty) window.sessionStorage.removeItem('picdrop-demo-settings-dirty')
    window.history.pushState({}, '', next)
    setRoute({ pathname: target.pathname.replace(/\/$/, '') || '/admin', search: target.search })
    setMobileNavOpen(false)
    setAccountOpen(false)
    setSearch('')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    const deliveries = frame.data.deliveries.filter((delivery) => `${delivery.id} ${delivery.pickup} ${delivery.drop}`.toLowerCase().includes(query)).slice(0, 5).map((delivery) => ({ label: delivery.id, detail: `${delivery.pickup} → ${delivery.drop}`, path: `/admin/deliveries/${delivery.id}`, type: 'Delivery' }))
    const partners = frame.data.partners.filter((partner) => `${partner.id} ${partner.name} ${partner.serviceAreas.join(' ')}`.toLowerCase().includes(query)).slice(0, 4).map((partner) => ({ label: partner.name, detail: `${partner.id} · ${partner.availability}`, path: `/admin/partners/${partner.id}`, type: 'Partner' }))
    return [...deliveries, ...partners].slice(0, 7)
  }, [frame.data.deliveries, frame.data.partners, search])

  function submitSearch() {
    if (matches.length) open(matches[0].path)
    else if (search.trim()) open(`/admin/deliveries?q=${encodeURIComponent(search.trim())}`)
  }

  const query = new URLSearchParams(route.search)
  const partnersView = query.get('view')
  const deliveryMatch = route.pathname.match(/^\/admin\/deliveries\/([^/]+)(?:\/(assign))?$/)
  const partnerMatch = route.pathname.match(/^\/admin\/partners\/([^/]+)$/)
  const isAssignmentRoute = Boolean(deliveryMatch?.[2])
  const isDeliveryDetail = Boolean(deliveryMatch && !deliveryMatch[2])
  const selectedDelivery = deliveryMatch ? frame.data.deliveries.find((delivery) => delivery.id === decodeURIComponent(deliveryMatch[1])) : undefined
  const selectedPartnerId = partnerMatch ? decodeURIComponent(partnerMatch[1]) : ''

  const pageTitle = activeLabel === 'Overview' ? 'Operations Overview'
    : activeLabel === 'Deliveries' ? isAssignmentRoute ? `Assign partner · ${selectedDelivery?.id ?? ''}` : isDeliveryDetail ? `Delivery ${selectedDelivery?.id ?? ''}` : 'Deliveries'
      : activeLabel === 'Partners' ? partnerMatch ? `Partner · ${selectedPartnerId}` : partnersView === 'new' ? 'Add partner' : partnersView === 'app' ? 'Partner app data' : partnersView === 'activity' ? 'Partner activity' : 'Delivery partners'
        : activeLabel === 'KYC Review' ? 'KYC Review'
          : activeLabel
  const pageSubtitle = activeLabel === 'Overview' ? 'A clear view of the delivery queue, partner availability, and operational exceptions.'
    : activeLabel === 'Deliveries' ? isAssignmentRoute ? '' : isDeliveryDetail ? 'Operational record, assignment history, and delivery milestones.' : 'Search, filter, assign, and review demo delivery jobs.'
      : activeLabel === 'Partners' ? partnerMatch ? 'Verification, eligibility, availability, and delivery history.' : partnersView === 'new' ? 'Create a partner directory record. Mandatory KYC documents are queued as missing.' : partnersView === 'app' ? 'Read-only delivery_app records synced from the partner backend.' : partnersView === 'activity' ? 'Audit partner activity and suspend or restore a partner when required.' : 'Review delivery-partner availability, verification, and assignment eligibility.'
        : activeLabel === 'KYC Review' ? 'Review onboarding KYC applications from this console and delivery_app. Administrator approval only.'
          : activeLabel === 'Notifications' ? 'Event-driven operational notifications from local demo workflows.'
            : activeLabel === 'Audit Logs' ? 'Append-only history of administrative operations in this demo.'
              : 'Local demo configurations and simulated administrative access.'

  const routeKnown = ['/admin', '/admin/deliveries', '/admin/partners', '/admin/kyc', '/admin/notifications', '/admin/audit-logs', '/admin/settings'].includes(routePath) || Boolean(deliveryMatch || partnerMatch)
  const showHeading = routeKnown && !isAssignmentRoute
  const partnerViewLabel = partnersView === 'new' ? 'Add partner' : partnersView === 'app' ? 'Partner app data' : partnersView === 'activity' ? 'Partner activity' : ''
  const breadcrumbs = isDeliveryDetail && selectedDelivery ? [{ label: 'Overview', path: '/admin' }, { label: 'Deliveries', path: '/admin/deliveries' }, { label: selectedDelivery.id }] : partnerMatch ? [{ label: 'Overview', path: '/admin' }, { label: 'Partners', path: '/admin/partners' }, { label: selectedPartnerId }] : activeLabel === 'Overview' ? undefined : activeLabel === 'Partners' && partnerViewLabel ? [{ label: 'Overview', path: '/admin' }, { label: 'Partners', path: '/admin/partners' }, { label: partnerViewLabel }] : [{ label: 'Overview', path: '/admin' }, { label: activeLabel }]

  function signOut() {
    clearAdminSession()
    setAccountOpen(false)
    setMobileNavOpen(false)
    setSearch('')
    onSignedOut()
  }

  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <div className="brand-lockup"><BrandMark /><div><strong>PicDrop <span>+</span> HopNgo</strong><small>Delivery Operations</small></div></div>
      <div className="sidebar-environment"><span className="environment-dot" />DEMO ENVIRONMENT</div>
      <nav className="side-nav" id="primary-navigation" aria-label="Main navigation">
        <span className="side-nav-label">OPERATIONS</span>
        {navItems.map((item) => <button key={item.path} className={`nav-item ${isActive(routePath, item.path) ? 'active' : ''}`} onClick={() => open(item.path)} title={collapsed ? item.label : undefined} aria-current={isActive(routePath, item.path) ? 'page' : undefined}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.label === 'Notifications' && unreadCount > 0 && <b className="nav-count">{unreadCount}</b>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="side-support-note"><Icon name="shield" size={15} /><span>Local demo<br />No live integrations</span></div><button className="profile-card" onClick={() => setAccountOpen(true)} aria-haspopup="dialog" aria-label="Open Administrator account details"><span className="avatar">{initials(frame.data.user.name)}</span><span className="profile-copy"><strong>{frame.data.user.name}</strong><small>{frame.data.user.role}</small></span><Icon name="more" size={16} /></button></div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <button className="sidebar-toggle" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed} aria-controls="primary-navigation" title={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed((value) => !value)}><Icon name="menu" size={18} /></button>
        <button className="mobile-menu-button" aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNavOpen} aria-controls="primary-navigation" onClick={() => setMobileNavOpen((value) => !value)}><Icon name="menu" size={19} /></button>
        <div className="topbar-breadcrumb"><span>Delivery Operations</span><Icon name="chevron" size={13} /><strong>{isDeliveryDetail ? selectedDelivery?.id ?? 'Delivery' : isAssignmentRoute ? 'Assignment' : partnerMatch ? selectedPartnerId : activeLabel}</strong></div>
        <div className="topbar-spacer" />
        <div className="global-search-wrap"><label className="global-search"><Icon name="search" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitSearch(); if (event.key === 'Escape') setSearch('') }} placeholder="Search deliveries, partners…" aria-label="Search deliveries and partners" /><kbd>⌘ K</kbd></label>
          {search.trim() && <div className="global-search-results">{matches.length ? matches.map((item) => <button key={item.path} onClick={() => open(item.path)}><span className="search-result-icon"><Icon name={item.type === 'Delivery' ? 'deliveries' : 'partners'} size={15} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><small>{item.type}</small></button>) : <button onClick={submitSearch}><span className="search-result-icon"><Icon name="search" size={15} /></span><span><strong>Search deliveries for “{search}”</strong><small>Open filtered delivery list</small></span><Icon name="arrow" size={14} /></button>}</div>}
        </div>
        <button className={`topbar-notification ${activeLabel === 'Notifications' ? 'topbar-selected' : ''}`} onClick={() => open('/admin/notifications')} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}><Icon name="notifications" size={18} />{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
        <button className="topbar-user" onClick={() => setAccountOpen(true)} aria-label="Open Administrator account details" aria-haspopup="dialog" title="Administrator account"><span className="avatar avatar-small">{initials(frame.data.user.name)}</span><Icon name="chevron" size={14} /></button>
      </header>

      {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="page-content" id="main-content">
        {!storageAvailable && <div className="storage-warning"><Icon name="alert" size={16} /><span>Browser storage is unavailable. Changes may not persist after refresh.</span></div>}
        {showHeading && <PageHeading title={pageTitle} subtitle={pageSubtitle} breadcrumbs={breadcrumbs} onNavigate={open} />}
        {routePath === '/admin' && <OverviewPage data={frame.data} open={open} />}
        {routePath === '/admin/deliveries' && <DeliveriesPage data={frame.data} open={open} statusFromUrl={query.get('status') ?? undefined} initialSearch={query.get('q') ?? ''} />}
        {isDeliveryDetail && selectedDelivery && <DeliveryDetailPage data={frame.data} delivery={selectedDelivery} open={open} />}
        {isAssignmentRoute && selectedDelivery && <AssignmentPage data={frame.data} delivery={selectedDelivery} open={open} />}
        {deliveryMatch && !selectedDelivery && <div className="route-not-found"><Icon name="alert" size={22} /><h2>Delivery not found</h2><p>The requested record is not available in local demo data.</p><Button onClick={() => open('/admin/deliveries')}>Back to deliveries</Button></div>}
        {routePath === '/admin/partners' && <PartnersPage data={frame.data} open={open} viewFromUrl={partnersView ?? undefined} />}
        {routePath === '/admin/kyc' && <KycReviewPage data={frame.data} open={open} />}
        {partnerMatch && <PartnerProfilePage data={frame.data} open={open} partnerId={selectedPartnerId} initialDocumentId={query.get('document')} />}
        {routePath === '/admin/notifications' && <NotificationsPage data={frame.data} open={open} />}
        {routePath === '/admin/audit-logs' && <AuditLogsPage data={frame.data} />}
        {routePath === '/admin/settings' && <SettingsPage data={frame.data} session={session} onOpenAccount={() => setAccountOpen(true)} initialTab={query.get('tab') ?? undefined} />}
        {!['/admin', '/admin/deliveries', '/admin/partners', '/admin/kyc', '/admin/notifications', '/admin/audit-logs', '/admin/settings'].includes(routePath) && !deliveryMatch && !partnerMatch && <div className="route-not-found"><Icon name="search" size={22} /><h2>Page not found</h2><p>This route is not part of the Delivery Operations demo console.</p><Button variant="primary" onClick={() => open('/admin')}>Go to overview</Button></div>}
      </main>
    </div>
    {toast && <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}><span className="toast-icon"><Icon name={toast.kind === 'error' ? 'alert' : toast.kind === 'info' ? 'info' : 'check'} size={15} /></span>{toast.message}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={14} /></button></div>}
    {accountOpen && <AdminAccountDialog user={frame.data.user} session={session} onClose={() => setAccountOpen(false)} onSignOut={signOut} />}
  </div>
}

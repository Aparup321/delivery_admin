import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OperationsState, PartnerAppTicket } from '../domain/model'
import { Button, Dialog, EmptyState, formatDate, Icon, Panel, StatusBadge } from '../components/ui'
import { userCan } from '../domain/admin'
import { readPartnerAppToken, syncPartnerAppTickets, updateSupportTicketStatus } from '../services/partnerApp'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
import { activeQuotaMessage, clearQuotaBlock, describeSyncError, readQuotaBlockedUntil } from '../services/firestoreQuota'
import { useOperations } from '../state/OperationsProvider'

function statusLabel(value: string) {
  return value.trim().toLowerCase() === 'resolved' ? 'Resolved' : 'Open'
}

export function SupportTicketsPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame, dispatch } = useOperations()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'All' | 'Open' | 'Resolved'>('All')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canManage = userCan(frame.data.user, 'partner-management')
  const firebaseConnected = hasFirebaseAdminSession()
  const [refreshing, setRefreshing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const inFlight = useRef(false)

  const refreshTickets = useCallback(async (force = false) => {
    if (!firebaseConnected || data.partnerApp.mode !== 'firestore' || !data.partnerApp.projectId.trim()) return
    if (inFlight.current) return
    if (force) clearQuotaBlock(data.partnerApp.projectId)
    const paused = activeQuotaMessage(data.partnerApp.projectId)
    if (readQuotaBlockedUntil(data.partnerApp.projectId)) {
      setSyncError(paused ?? '')
      return
    }
    inFlight.current = true
    setRefreshing(true)
    try {
      const tickets = await syncPartnerAppTickets(data.partnerApp, readPartnerAppToken())
      dispatch({ type: 'partnerApp.tickets', tickets, at: new Date().toISOString() })
      setSyncError('')
    } catch (refreshError) {
      setSyncError(describeSyncError(refreshError, 'Support tickets could not be synced from delivery_app.', data.partnerApp.projectId))
    } finally {
      inFlight.current = false
      setRefreshing(false)
    }
  }, [
    data.partnerApp.mode,
    data.partnerApp.projectId,
    data.partnerApp.apiKey,
    data.partnerApp.databaseId,
    data.partnerApp.partnersCollection,
    data.partnerApp.endpointUrl,
    dispatch,
    firebaseConnected,
  ])

  useEffect(() => {
    if (!firebaseConnected || data.partnerApp.mode !== 'firestore' || !data.partnerApp.projectId.trim()) return
    let active = true
    const load = () => {
      if (!active || document.visibilityState === 'hidden') return
      void refreshTickets()
    }
    load()
    const timer = window.setInterval(load, 30_000)
    const onFocus = () => load()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [firebaseConnected, data.partnerApp.mode, data.partnerApp.projectId, refreshTickets])

  const tickets = useMemo(() => data.partnerAppTickets.filter((ticket) => {
    const query = search.trim().toLowerCase()
    return (!query || [ticket.id, ticket.subject, ticket.message, ticket.partnerUid].join(' ').toLowerCase().includes(query))
      && (status === 'All' || statusLabel(ticket.status) === status)
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [data.partnerAppTickets, search, status])

  const selectedTicket = selected ? data.partnerAppTickets.find((ticket) => ticket.id === selected) : undefined
  const openCount = data.partnerAppTickets.filter((ticket) => statusLabel(ticket.status) === 'Open').length

  function partnerFor(ticket: PartnerAppTicket) {
    return data.partners.find((partner) => partner.partnerAppUid === ticket.partnerUid)
  }

  async function resolve(ticket: PartnerAppTicket) {
    if (!canManage || !firebaseConnected) return
    setBusy(true)
    setError('')
    try {
      await updateSupportTicketStatus(data.partnerApp, readPartnerAppToken(), ticket.id, 'Resolved')
      dispatch({ type: 'partnerApp.ticket-status', ticketId: ticket.id, status: 'Resolved', at: new Date().toISOString() })
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Could not resolve the support ticket.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="page-stack">
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{tickets.length}</strong><span>support tickets</span><span className="dot-separator" />{openCount} open</div><div className="row-action-group"><span className="demo-caption">Synced from delivery_app</span>{firebaseConnected && <Button size="small" variant="quiet" disabled={refreshing} onClick={() => { void refreshTickets(true) }}><Icon name="refresh" size={14} />{refreshing ? 'Refreshing…' : 'Refresh tickets'}</Button>}</div></div>
      <div className="filter-toolbar kyc-filter-toolbar">
        <label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticket, subject, message, or partner" aria-label="Search support tickets" /></label>
        <label className="filter-control"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option>All</option><option>Open</option><option>Resolved</option></select></label>
      </div>
      {!firebaseConnected && <div className="notification-history-note"><Icon name="info" size={14} />Sign in with a Firebase administrator to update ticket status in delivery_app. Synced tickets are still visible here.</div>}
      {syncError && <div className="soft-notice error-notice"><Icon name="alert" size={15} /><span>{syncError}</span></div>}
      {error && <div className="soft-notice error-notice"><Icon name="alert" size={15} /><span>{error}</span></div>}
      <div className="table-scroll"><table className="data-table support-table"><thead><tr><th>Ticket</th><th>Partner</th><th>Status</th><th>Raised</th><th>Actions</th></tr></thead><tbody>
        {tickets.map((ticket) => {
          const partner = partnerFor(ticket)
          return <tr key={ticket.id}>
            <td><span className="support-ticket-cell"><strong>{ticket.subject}</strong><small>{ticket.id} · {ticket.message}</small></span></td>
            <td>{partner ? <button className="partner-cell partner-profile-button" onClick={() => open(`/admin/partners/${partner.id}`)}><span className="mini-avatar">{partner.name.split(' ').map((part) => part[0]).join('').replace('.', '')}</span><span><b>{partner.name}</b><small>{partner.id}</small></span></button> : <span className="muted-text">{ticket.partnerUid}</span>}</td>
            <td><StatusBadge status={statusLabel(ticket.status)} /></td>
            <td>{formatDate(ticket.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td><span className="row-action-group"><Button size="small" variant="quiet" onClick={() => setSelected(ticket.id)}>Open</Button>{statusLabel(ticket.status) === 'Open' && <Button size="small" variant="primary" disabled={!canManage || !firebaseConnected || busy} title={!canManage ? 'Partner management access required' : undefined} onClick={() => { void resolve(ticket) }}>Resolve</Button>}</span></td>
          </tr>
        })}
      </tbody></table>{tickets.length === 0 && <EmptyState title="No support tickets match" detail="Tickets raised in delivery_app appear here within about 30 seconds. Use Refresh tickets to check immediately." />}</div>
    </Panel>

    {selectedTicket && <Dialog title={selectedTicket.subject} eyebrow="SUPPORT TICKET" onClose={() => setSelected(null)}>
      <div className="dialog-form">
        <div className="application-review-summary details-summary">
          <div><span>Ticket</span><strong>{selectedTicket.id}</strong></div>
          <div><span>Status</span><strong>{statusLabel(selectedTicket.status)}</strong></div>
          <div><span>Raised</span><strong>{formatDate(selectedTicket.createdAt)}</strong></div>
          <div><span>Partner UID</span><strong>{selectedTicket.partnerUid}</strong></div>
        </div>
        <div className="audit-value-block"><span>Message</span><p>{selectedTicket.message}</p></div>
        <div className="dialog-actions">
          <Button onClick={() => setSelected(null)}>Close</Button>
          {statusLabel(selectedTicket.status) === 'Open' && <Button variant="primary" disabled={!canManage || !firebaseConnected || busy} onClick={() => { void resolve(selectedTicket) }}>Mark resolved</Button>}
        </div>
      </div>
    </Dialog>}
  </div>
}

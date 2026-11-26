import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { DocumentStatus, OperationsState, Partner, PartnerAppRecord, PartnerDocument } from '../domain/model'
import { getActiveAssignment, getPartnerEligibility, isDocumentCurrent } from '../domain/operations'
import {
  displayedDocumentStatus,
  documentLabel,
  formatDocumentNumber,
  partnerDocumentNumber,
  partnerVerification,
  requiredLiveDocumentKeys,
  submittedLiveDocumentKeys,
} from '../domain/kyc'
import { Button, ConfirmDialog, Dialog, EmptyState, formatDate, Icon, initials, Panel, PanelHeading, StatusBadge } from '../components/ui'
import { SuspendPartnerDialog } from '../components/SuspendPartnerDialog'
import { formatSuspensionEnd, suspensionTimeline } from '../domain/suspension'
import { useOperations } from '../state/OperationsProvider'
import { beginFirebaseDataConnection } from '../auth/adminSession'
import { partnerAppEndpoint, readPartnerAppToken, syncPartnerAppRecords } from '../services/partnerApp'
import { clearQuotaBlock, describeSyncError } from '../services/firestoreQuota'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
import { userCan } from '../domain/admin'
import { PartnerCreatePage } from './PartnerCreatePage'

type PartnersSection = 'directory' | 'activity' | 'new' | 'expiring' | 'app'

interface DirectoryProps {
  data: OperationsState
  open: (path: string) => void
  viewFromUrl?: string
}

function PartnerSectionTabs({ active, data, open }: { active: PartnersSection; data: OperationsState; open: (path: string) => void }) {
  const expiringCount = data.documents.filter((document) => document.expiresAt && new Date(document.expiresAt).getTime() <= Date.now() + 30 * 24 * 60 * 60_000).length
  return <div className="partner-section-tabs"><button className={active === 'directory' ? 'active' : ''} onClick={() => open('/admin/partners')}>All partners<span>{data.partners.length}</span></button><button className={active === 'activity' ? 'active' : ''} onClick={() => open('/admin/partners?view=activity')}>Partner activity<span>{data.partnerHistory.length}</span></button><button className={active === 'expiring' ? 'active' : ''} onClick={() => open('/admin/partners?view=expiring')}>Expiring documents<span>{expiringCount}</span></button><button className={active === 'app' ? 'active' : ''} onClick={() => open('/admin/partners?view=app')}>Partner app<span>{data.partnerAppRecords.length}</span></button></div>
}

interface ExpiringDocumentRow {
  key: string
  partnerId: string | null
  partnerName: string
  label: string
  reference: string
  status: string
  expiresAt: string
  reviewer: string | null
  documentId: string | null
}

function ExpiringDocumentsPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame } = useOperations()
  const canReview = userCan(frame.data.user, 'document-review')
  const now = Date.now()
  const cutoff = now + 30 * 24 * 60 * 60_000
  const localRows: ExpiringDocumentRow[] = data.documents
    .filter((document) => document.expiresAt && new Date(document.expiresAt).getTime() <= cutoff)
    .map((document) => {
      const partner = data.partners.find((item) => item.id === document.partnerId)
      return {
        key: document.id,
        partnerId: partner?.id ?? null,
        partnerName: partner?.name ?? document.partnerId,
        label: document.type,
        reference: document.id,
        status: displayedDocumentStatus(document),
        expiresAt: document.expiresAt!,
        reviewer: document.reviewer,
        documentId: document.id,
      }
    })
  const liveRows: ExpiringDocumentRow[] = data.partnerAppDocuments.flatMap((document) => {
    const partner = data.partners.find((item) => item.partnerAppUid === document.id)
    return document.files.flatMap((file) => file.review?.expiresAt && new Date(file.review.expiresAt).getTime() <= cutoff
      ? [{
        key: `${document.id}:${file.key}`,
        partnerId: partner?.id ?? null,
        partnerName: partner?.name ?? document.id,
        label: documentLabel(file.key),
        reference: file.fileName ?? 'delivery_app document',
        status: file.review.status,
        expiresAt: file.review.expiresAt,
        reviewer: file.review.reviewedBy,
        documentId: null,
      }]
      : [])
  })
  const documents = [...localRows, ...liveRows].sort((left, right) => new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime())

  function expiryLabel(document: ExpiringDocumentRow) {
    const expiresAt = new Date(document.expiresAt).getTime()
    const days = Math.ceil((expiresAt - now) / (24 * 60 * 60_000))
    if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
    if (days === 0) return 'Expires today'
    return `Expires in ${days} day${days === 1 ? '' : 's'}`
  }

  function reviewRow(document: ExpiringDocumentRow) {
    if (document.documentId && document.partnerId) open(`/admin/partners/${document.partnerId}?document=${encodeURIComponent(document.documentId)}`)
    else open('/admin/kyc')
  }

  return <div className="page-stack">
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{documents.length}</strong><span>documents expired or expiring</span><span className="dot-separator" />{documents.filter((document) => new Date(document.expiresAt).getTime() <= now).length} overdue</div><span className="demo-caption">Next 30 days · local and delivery_app</span></div>
      <div className="notification-history-note"><Icon name="clock" size={14} />Review expired documents first. Updating a document review recalculates the partner's assignment eligibility. delivery_app documents are reviewed from KYC Review → Details.</div>
      <div className="table-scroll"><table className="data-table expiring-documents-table"><thead><tr><th>Partner</th><th>Document</th><th>Status</th><th>Expiry</th><th>Reviewer</th><th>Action</th></tr></thead><tbody>
        {documents.map((document) => <tr key={document.key}>
          <td>{document.partnerId ? <button className="partner-cell partner-profile-button" onClick={() => open(`/admin/partners/${document.partnerId}`)}><span className="mini-avatar">{initials(document.partnerName)}</span><span><b>{document.partnerName}</b><small>{document.partnerId}</small></span></button> : <span className="muted-text">{document.partnerName}</span>}</td>
          <td><span className="document-main"><strong>{document.label}<small>{document.reference}</small></strong></span></td>
          <td><StatusBadge status={document.status} /></td>
          <td><span className={`expiry-cell ${new Date(document.expiresAt).getTime() <= now ? 'overdue' : ''}`}><strong>{formatDate(document.expiresAt, { month: 'short', day: 'numeric', year: 'numeric' })}</strong><small>{expiryLabel(document)}</small></span></td>
          <td>{document.reviewer ?? <span className="muted-text">Not reviewed</span>}</td>
          <td><Button size="small" variant="quiet" disabled={!canReview} title={canReview ? undefined : 'Document review access required'} onClick={() => reviewRow(document)}>Review document</Button></td>
        </tr>)}
      </tbody></table>{documents.length === 0 && <EmptyState title="No documents are expiring soon" detail="Documents with an expiry within the next 30 days or already expired appear here. Review delivery_app documents from KYC Review to record an expiry." />}</div>
    </Panel>
  </div>
}

function appStatusLabel(value: string | null) {
  if (!value) return ''
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function linkedPartnerForRecord(data: OperationsState, record: PartnerAppRecord) {
  return data.partners.find((partner) => partner.partnerAppUid === record.id)
    ?? data.partners.find((partner) => partner.id === record.partnerId || partner.id === record.id)
}

function applicationForRecord(data: OperationsState, record: PartnerAppRecord, partner: Partner | undefined) {
  return data.applications.find((application) => application.partnerAppUid === record.id)
    ?? (partner ? data.applications.find((application) => application.partnerId === partner.id) : undefined)
}

function PartnerAppRecordDialog({ record, data, onClose, open }: { record: PartnerAppRecord; data: OperationsState; onClose: () => void; open: (path: string) => void }) {
  const { frame, dispatch } = useOperations()
  const [accountDialog, setAccountDialog] = useState<'suspend' | 'restore' | null>(null)
  const [linkPartnerId, setLinkPartnerId] = useState('')
  const canManage = userCan(frame.data.user, 'partner-management')
  const entries = Object.entries(record.fields).sort(([a], [b]) => a.localeCompare(b))
  const linkedPartner = linkedPartnerForRecord(data, record)
  const application = applicationForRecord(data, record, linkedPartner)
  const linkedByUid = data.partners.find((partner) => partner.partnerAppUid === record.id)
  const linkablePartners = data.partners.filter((partner) => !partner.partnerAppUid || partner.partnerAppUid === record.id).sort((a, b) => a.id.localeCompare(b.id))
  const recordStatus = (record.applicationStatus ?? '').toLowerCase()
  const firebaseSignedIn = hasFirebaseAdminSession()
  const accountActionable = application?.status === 'Approved' || recordStatus === 'approved'

  if (accountDialog === 'suspend' && linkedPartner) {
    return <SuspendPartnerDialog partnerName={linkedPartner.name} detail="This suspends the same account in delivery_app as soon as the write-through completes. The partner is set offline, cannot receive requests, and is reinstated automatically when the timeline ends. Existing delivery history is retained." onCancel={() => setAccountDialog(null)} onConfirm={(reason, durationDays) => { dispatch({ type: 'partner.restrict', partnerId: linkedPartner.id, status: 'Suspended', reason, durationDays }); setAccountDialog(null) }} />
  }

  if (accountDialog === 'restore' && linkedPartner) {
    return <ConfirmDialog title={`Restore ${linkedPartner.name}?`} detail="This reinstates the same delivery_app account when the application is approved. The partner can go online again after the write-through completes." reasonLabel="Reinstatement reason" confirmLabel="Restore partner" onCancel={() => setAccountDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restore', partnerId: linkedPartner.id, reason }); setAccountDialog(null) }} />
  }

  return <Dialog title={`Partner app record ${record.id}`} eyebrow="PARTNER APP DATA" wide onClose={onClose}>
    <div className="app-record-detail">
      <div className="app-record-head"><span className="mini-avatar">{initials(record.name)}</span><div><strong>{record.name}</strong><small>{record.id} · synced {formatDate(record.syncedAt)}</small></div>{linkedByUid ? <StatusBadge status={`Linked · ${linkedByUid.id}`} /> : <span className="status-badge status-not-linked"><i className="status-dot" />Not linked</span>}</div>
      <div className="app-record-grid">
        <div><span>Partner ID</span><strong>{record.partnerId ?? '—'}</strong></div>
        <div><span>Phone</span><strong>{record.phone ?? '—'}</strong></div>
        <div><span>Email</span><strong>{record.email ?? '—'}</strong></div>
        <div><span>Vehicle</span><strong>{record.vehicle ?? '—'}</strong></div>
        <div><span>Application</span><strong>{record.applicationStatus ? <StatusBadge status={appStatusLabel(record.applicationStatus)} /> : '—'}</strong></div>
        <div><span>Account</span><strong>{record.status ? <StatusBadge status={record.status} /> : '—'}</strong></div>
        <div><span>Admin partner</span><strong>{linkedPartner ? `${linkedPartner.id} · ${linkedPartner.name}` : '—'}</strong></div>
        <div><span>Service areas</span><strong>{record.serviceAreas.length ? record.serviceAreas.join(', ') : '—'}</strong></div>
      </div>

      <div className="app-record-actions">
        <div>
          <strong>Live delivery_app account</strong>
          <span>{linkedByUid
            ? `Partner account actions write to this partner document when a Firebase administrator is signed in under Settings → Partner app.${firebaseSignedIn ? '' : ' No Firebase administrator is signed in yet.'}`
            : 'Link this record to an admin partner before suspending or reinstating the delivery_app account. KYC approval is handled from KYC Review.'}</span>
        </div>
        <div className="row-action-group">
          {linkedByUid && accountActionable && (linkedByUid.availability === 'Suspended' || linkedByUid.availability === 'Restricted'
            ? <Button size="small" variant="primary" disabled={!canManage} onClick={() => setAccountDialog('restore')}>Restore account</Button>
            : <Button size="small" variant="danger" disabled={!canManage} onClick={() => setAccountDialog('suspend')}>Suspend account</Button>)}
        </div>
      </div>

      <div className="app-record-link">
        {linkedByUid ? <>
          <span>Linked to <strong>{linkedByUid.id} · {linkedByUid.name}</strong>. Unlinking leaves the admin record unchanged.</span>
          <Button size="small" variant="quiet" disabled={!canManage} onClick={() => dispatch({ type: 'partnerApp.unlink', partnerId: linkedByUid.id })}>Unlink record</Button>
        </> : <>
          <label className="field-label">Link to an admin partner<select value={linkPartnerId} disabled={!canManage} onChange={(event) => setLinkPartnerId(event.target.value)}><option value="">Choose a partner</option>{linkablePartners.map((partner) => <option key={partner.id} value={partner.id}>{partner.id} · {partner.name}</option>)}</select><span className="field-help">Linking matches this delivery_app UID to the admin record and its onboarding application.</span></label>
          <Button size="small" variant="primary" disabled={!canManage || !linkPartnerId} onClick={() => { dispatch({ type: 'partnerApp.link', recordId: record.id, partnerId: linkPartnerId }); setLinkPartnerId('') }}>Link record</Button>
        </>}
      </div>

      <div className="app-record-fields"><span className="app-record-fields-label">Raw delivery_app fields</span>{entries.length ? entries.map(([key, value]) => <div className="app-record-field" key={key}><span>{key}</span><strong>{value}</strong></div>) : <p className="muted-copy">No fields were returned for this record.</p>}</div>
      <div className="dialog-actions"><Button onClick={onClose}>Close</Button>{linkedPartner && <Button variant="primary" onClick={() => { onClose(); open(`/admin/partners/${linkedPartner.id}`) }}>Open admin profile</Button>}</div>
    </div>
  </Dialog>
}

function PartnerAppDataPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame, dispatch, partnerAppWriteFailures, retryPartnerAppWrites } = useOperations()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [recordId, setRecordId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const pageSize = 10
  const config = data.partnerApp
  const configured = config.mode === 'firestore' ? Boolean(config.projectId.trim() && config.partnersCollection.trim()) : Boolean(config.endpointUrl.trim())
  let requestUrl = ''
  try {
    requestUrl = partnerAppEndpoint(config, 300)
  } catch {
    requestUrl = ''
  }
  const filtered = useMemo(() => data.partnerAppRecords.filter((record) => {
    const query = search.trim().toLowerCase()
    return !query || [record.id, record.partnerId ?? '', record.name, record.phone ?? '', record.email ?? '', record.vehicle ?? '', record.status ?? '', record.applicationStatus ?? '', ...record.serviceAreas].join(' ').toLowerCase().includes(query)
  }).sort((a, b) => (b.updatedAt ?? b.syncedAt).localeCompare(a.updatedAt ?? a.syncedAt)), [data.partnerAppRecords, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const record = recordId ? data.partnerAppRecords.find((item) => item.id === recordId) : undefined
  const firebaseSignedIn = hasFirebaseAdminSession()
  const canConfigure = userCan(frame.data.user, 'settings')

  async function refreshLive() {
    if (!firebaseSignedIn) {
      beginFirebaseDataConnection()
      return
    }
    if (!configured) {
      open('/admin/settings?tab=partner-app')
      return
    }
    setSyncing(true)
    try {
      const records = await syncPartnerAppRecords(config, readPartnerAppToken())
      clearQuotaBlock(config.projectId)
      dispatch({ type: 'partnerApp.sync-result', records, at: new Date().toISOString(), silent: true })
    } catch (error) {
      dispatch({ type: 'partnerApp.failed', message: describeSyncError(error, 'Partner data refresh failed.', config.projectId) })
    } finally {
      setSyncing(false)
    }
  }

  return <>
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>partner app records</span><span className="dot-separator" />{data.partners.filter((partner) => partner.partnerAppUid).length} linked partners · {config.lastSyncAt ? `Synced ${formatDate(config.lastSyncAt)}` : 'Never synced'}</div><div className="row-action-group">{firebaseSignedIn
        ? <Button size="small" onClick={refreshLive} disabled={syncing || !configured}><Icon name="refresh" size={14} />{syncing ? 'Refreshing…' : 'Refresh live data'}</Button>
        : <Button size="small" variant="primary" onClick={beginFirebaseDataConnection} disabled={!configured}><Icon name="lock" size={14} />Sign in to load live partners</Button>}{canConfigure && <Button size="small" onClick={() => open('/admin/settings?tab=partner-app')}><Icon name="settings" size={14} />Connection settings</Button>}</div></div>
      {!firebaseSignedIn && <div className="soft-notice"><Icon name="info" size={15} /><span className="partner-app-notice-copy">You are viewing the demo workspace. The new delivery_app partner will appear after signing in with the Firebase administrator account and refreshing live data.</span></div>}
      {!configured ? <EmptyState title="Partner app not connected" detail={canConfigure ? 'Enter the delivery_admin Firebase config (same project as delivery_app) in Settings → Partner app, then sync partner records.' : 'A main administrator must connect the shared Firebase project before partner records can sync.'} action={canConfigure ? <Button variant="primary" onClick={() => open('/admin/settings?tab=partner-app')}>Configure partner app</Button> : undefined} /> : <>
        {config.lastError && <div className="soft-notice"><Icon name="alert" size={15} /><span className="partner-app-notice-copy">Last delivery_app update failed: {config.lastError}{requestUrl && <small className="partner-app-error-url">Request: {requestUrl}</small>}</span>{partnerAppWriteFailures > 0 && <Button size="small" variant="primary" onClick={retryPartnerAppWrites}>Retry {partnerAppWriteFailures} update{partnerAppWriteFailures === 1 ? '' : 's'}</Button>}</div>}
        {data.partnerAppRecords.length === 0 ? <EmptyState title="No partner app records synced" detail={firebaseSignedIn ? 'Refresh live data to load the partners collection from delivery_app.' : 'Sign in with the Firebase administrator account to load the live partners collection. Demo records do not call Firebase.'} action={firebaseSignedIn
          ? <Button variant="primary" onClick={refreshLive} disabled={syncing || !configured}><Icon name="refresh" size={14} />{syncing ? 'Refreshing…' : 'Refresh live data'}</Button>
          : <Button variant="primary" onClick={beginFirebaseDataConnection} disabled={!configured}><Icon name="lock" size={14} />Sign in with Firebase</Button>} /> : <>
          <div className="filter-toolbar kyc-filter-toolbar"><label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search record, partner ID, contact, vehicle, status, or application" aria-label="Search partner app records" /></label></div>
          <div className="table-scroll"><table className="data-table app-data-table"><thead><tr><th>App record</th><th>Contact</th><th>Vehicle / areas</th><th>Application</th><th>Account</th><th>Admin partner</th><th>Updated</th><th /></tr></thead><tbody>
            {visible.map((item) => {
              const partner = linkedPartnerForRecord(data, item)
              const application = applicationForRecord(data, item, partner)
              return <tr key={item.id}>
                <td><span className="partner-cell"><span className="mini-avatar">{initials(item.name)}</span><span><b>{item.name}</b><small>{item.id}</small></span></span></td>
                <td><span className="application-documents"><strong>{item.phone ?? 'No phone'}</strong><small>{item.email ?? 'No email'}</small></span></td>
                <td><span className="application-documents"><strong>{item.vehicle ?? '—'}</strong><small>{item.serviceAreas.slice(0, 2).join(', ') || 'No areas'}{item.serviceAreas.length > 2 ? ` +${item.serviceAreas.length - 2}` : ''}</small></span></td>
                <td>{item.applicationStatus ? <StatusBadge status={appStatusLabel(item.applicationStatus)} /> : <span className="muted-text">—</span>}</td>
                <td>{item.status ? <StatusBadge status={item.status} /> : <span className="muted-text">—</span>}</td>
                <td>{partner ? <button className="table-record-link" onClick={() => open(`/admin/partners/${partner.id}`)}>{partner.id}<small>{partner.name}</small></button> : application ? <span className="muted-text">{application.id}<small>Application only</small></span> : <span className="muted-text">Not linked</span>}</td>
                <td>{formatDate(item.updatedAt ?? item.syncedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td><Button size="small" onClick={() => setRecordId(item.id)}>Manage</Button></td>
              </tr>
            })}
          </tbody></table>{visible.length === 0 && <EmptyState title="No matching partner app records" detail="Adjust the search to find a synced delivery_app record." />}</div>
          <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
        </>}
        <div className="notification-history-note"><Icon name="shield" size={14} />Synced records are a cache. Link a record to an admin partner, then suspend or restore the live account from this view. Onboarding applications are approved or rejected from KYC Review.</div>
      </>}
    </Panel>
    {record && <PartnerAppRecordDialog record={record} data={data} onClose={() => setRecordId(null)} open={open} />}
  </>
}

function PartnerActivityPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame, dispatch } = useOperations()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('All')
  const [page, setPage] = useState(1)
  const [suspendTarget, setSuspendTarget] = useState<Partner | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Partner | null>(null)
  const pageSize = 10
  const canManage = userCan(frame.data.user, 'partner-management')
  const types = [...new Set(data.partnerHistory.map((event) => event.type))].sort()
  const filtered = useMemo(() => data.partnerHistory.filter((event) => {
    const partner = data.partners.find((item) => item.id === event.partnerId)
    const query = search.trim().toLowerCase()
    return (type === 'All' || event.type === type)
      && (!query || `${event.partnerId} ${partner?.name ?? ''} ${event.type} ${event.description} ${event.actor}`.toLowerCase().includes(query))
  }).sort((a, b) => b.at.localeCompare(a.at)), [data.partnerHistory, data.partners, search, type])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  return <>
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>partner activity events</span><span className="dot-separator" />{data.partners.filter((partner) => partner.availability === 'Suspended').length} suspended partners</div><span className="demo-caption">Recorded from local workflows</span></div>
      <div className="filter-toolbar kyc-filter-toolbar"><label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search partner, activity, detail, or operator" aria-label="Search partner activity" /></label><label className="filter-control"><span>Activity type</span><select value={type} onChange={(event) => { setType(event.target.value); setPage(1) }}><option>All</option>{types.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className="table-scroll"><table className="data-table activity-table"><thead><tr><th>Partner</th><th>Activity</th><th>Details</th><th>Related record</th><th>Recorded by</th><th>When</th><th>Actions</th></tr></thead><tbody>
        {visible.map((event) => {
          const partner = data.partners.find((item) => item.id === event.partnerId)
          const relatedDelivery = event.relatedDeliveryId ? data.deliveries.find((delivery) => delivery.id === event.relatedDeliveryId) : undefined
          return <tr key={event.id}>
            <td>{partner ? <button className="partner-cell partner-profile-button" onClick={() => open(`/admin/partners/${partner.id}`)}><span className="mini-avatar">{initials(partner.name)}</span><span><b>{partner.name}</b><small>{partner.id} · {partner.availability}{partner.availability === 'Suspended' && partner.suspendedUntil ? ` until ${formatSuspensionEnd(partner.suspendedUntil)}` : ''}</small></span></button> : <span className="muted-text">{event.partnerId}</span>}</td>
            <td><span className="activity-event">{event.type}</span></td>
            <td><span className="activity-detail">{event.description}</span></td>
            <td>{relatedDelivery ? <button className="table-record-link" onClick={() => open(`/admin/deliveries/${relatedDelivery.id}`)}>{relatedDelivery.id}<small>{relatedDelivery.status}</small></button> : <span className="muted-text">—</span>}</td>
            <td>{event.actor}</td>
            <td>{formatDate(event.at, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td>{partner ? <span className="row-action-group">{partner.availability === 'Suspended' ? <Button size="small" disabled={!canManage} title={canManage ? 'Restore this suspended partner' : 'Partner management access required'} onClick={() => setRestoreTarget(partner)}>Restore</Button> : <Button size="small" variant="danger" disabled={!canManage} title={canManage ? 'Suspend this partner' : 'Partner management access required'} onClick={() => setSuspendTarget(partner)}>Suspend</Button>}</span> : <span className="muted-text">—</span>}</td>
          </tr>
        })}
      </tbody></table>{visible.length === 0 && <EmptyState title="No partner activity matches" detail="Adjust the activity type or search filters. Activity is recorded as partner actions occur." />}</div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
      <div className="notification-history-note"><Icon name="shield" size={14} />Partner-management access is required to suspend or reinstate a partner. Suspensions block new assignments and every decision is recorded in partner activity and the audit log.</div>
    </Panel>
    {suspendTarget && <SuspendPartnerDialog partnerName={suspendTarget.name} detail="Suspension blocks new assignments and offers. Existing delivery assignments and history are retained for an operations review, and eligibility returns automatically when the timeline ends." onCancel={() => setSuspendTarget(null)} onConfirm={(reason, durationDays) => { dispatch({ type: 'partner.restrict', partnerId: suspendTarget.id, status: 'Suspended', reason, durationDays }); setSuspendTarget(null) }} />}
    {restoreTarget && <ConfirmDialog title={`Restore ${restoreTarget.name}?`} detail="Restoring removes the suspension and makes the partner eligible again once document checks and any existing assignment allow it. The reinstatement is recorded in activity and the audit log." reasonLabel="Reinstatement reason" confirmLabel="Restore partner" onCancel={() => setRestoreTarget(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restore', partnerId: restoreTarget.id, reason }); setRestoreTarget(null) }} />}
  </>
}

export function PartnersPage({ data, open, viewFromUrl }: DirectoryProps) {
  const { frame, dispatch } = useOperations()
  const [search, setSearch] = useState('')
  const [availability, setAvailability] = useState('All')
  const [vehicle, setVehicle] = useState('All')
  const [area, setArea] = useState('All')
  const [verification, setVerification] = useState('All')
  const [eligibility, setEligibility] = useState('All')
  const [page, setPage] = useState(1)
  const [suspendTarget, setSuspendTarget] = useState<Partner | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Partner | null>(null)
  const pageSize = 8
  const canManage = userCan(frame.data.user, 'partner-management')
  const view: PartnersSection = viewFromUrl === 'app' ? 'app' : viewFromUrl === 'activity' ? 'activity' : viewFromUrl === 'new' ? 'new' : viewFromUrl === 'expiring' ? 'expiring' : 'directory'
  const areas = [...new Set(data.partners.flatMap((partner) => partner.serviceAreas))].sort()
  const deliveryForEligibility = data.deliveries.find((item) => item.status === 'Unassigned' || item.status === 'Pending') ?? data.deliveries.find((item) => !['Completed', 'Cancelled'].includes(item.status))

  const filtered = useMemo(() => data.partners.filter((partner) => {
    const query = search.trim().toLowerCase()
    const matchesQuery = !query || [partner.id, partner.name, partner.maskedPhone, partner.vehicle, ...partner.serviceAreas].join(' ').toLowerCase().includes(query)
    const status = partnerVerification(data, partner)
    const isEligible = deliveryForEligibility ? getPartnerEligibility(data, partner, deliveryForEligibility).eligible : partner.availability === 'Available'
    return matchesQuery && (availability === 'All' || partner.availability === availability)
      && (vehicle === 'All' || partner.vehicle === vehicle)
      && (area === 'All' || partner.serviceAreas.includes(area))
      && (verification === 'All' || status === verification)
      && (eligibility === 'All' || (eligibility === 'Eligible' ? isEligible : !isEligible))
  }).sort((a, b) => a.id.localeCompare(b.id)), [data, search, availability, vehicle, area, verification, eligibility, deliveryForEligibility])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  if (view === 'new') return <div className="page-stack"><div className="row-action-group"><Button size="small" onClick={() => open('/admin/partners')}><Icon name="arrow" size={14} className="icon-flip" />Back to partners</Button></div><PartnerCreatePage data={data} open={open} /></div>
  if (view === 'app') return <div className="page-stack"><PartnerSectionTabs active="app" data={data} open={open} /><PartnerAppDataPage data={data} open={open} /></div>
  if (view === 'activity') return <div className="page-stack"><PartnerSectionTabs active="activity" data={data} open={open} /><PartnerActivityPage data={data} open={open} /></div>
  if (view === 'expiring') return <div className="page-stack"><PartnerSectionTabs active="expiring" data={data} open={open} /><ExpiringDocumentsPage data={data} open={open} /></div>

  return <div className="page-stack">
    <PartnerSectionTabs active="directory" data={data} open={open} />
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>delivery partners</span><span className="dot-separator" />{data.partners.filter((item) => item.availability === 'Available').length} available now</div><div className="row-action-group"><span className="demo-caption">Live partner records from the connected Firebase project</span><Button size="small" variant="primary" disabled={!canManage} title={canManage ? undefined : 'Partner management access required'} onClick={() => open('/admin/partners?view=new')}><Icon name="plus" size={14} />Add partner</Button></div></div>
      <div className="filter-toolbar partner-filter-toolbar">
        <label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search name, partner ID, vehicle, area" aria-label="Search delivery partners" /></label>
        <label className="filter-control"><span>Availability</span><select value={availability} onChange={(event) => { setAvailability(event.target.value); setPage(1) }}><option>All</option><option>Available</option><option>On Delivery</option><option>Offline</option><option>Restricted</option><option>Suspended</option></select></label>
        <label className="filter-control"><span>Vehicle</span><select value={vehicle} onChange={(event) => { setVehicle(event.target.value); setPage(1) }}><option>All</option><option>Bike</option><option>Scooter</option><option>Van</option><option>Bicycle</option><option>On foot</option></select></label>
        <label className="filter-control"><span>Service area</span><select value={area} onChange={(event) => { setArea(event.target.value); setPage(1) }}><option>All</option>{areas.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="filter-control"><span>Verification</span><select value={verification} onChange={(event) => { setVerification(event.target.value); setPage(1) }}><option>All</option><option>Verified</option><option>Incomplete</option><option>Under Review</option><option>Attention Required</option></select></label>
        <label className="filter-control"><span>Eligibility</span><select value={eligibility} onChange={(event) => { setEligibility(event.target.value); setPage(1) }}><option>All</option><option>Eligible</option><option>Ineligible</option></select></label>
      </div>
      <div className="table-scroll"><table className="data-table partner-table"><thead><tr><th>Partner</th><th>Vehicle</th><th>Service area</th><th>Verification</th><th>Availability</th><th>Current assignment</th><th>Eligibility</th><th>Actions</th></tr></thead><tbody>
        {visible.map((partner) => {
          const active = getActiveAssignment(data, partner.id)
          const assignedDelivery = active ? data.deliveries.find((delivery) => delivery.id === active.deliveryId) : undefined
          const verificationState = partnerVerification(data, partner)
          const eligibilityResult = deliveryForEligibility ? getPartnerEligibility(data, partner, deliveryForEligibility) : { eligible: partner.availability === 'Available', reasons: [] }
          return <tr key={partner.id}>
            <td><button className="partner-cell partner-profile-button" onClick={() => open(`/admin/partners/${partner.id}`)}><span className="mini-avatar">{initials(partner.name)}</span><span><b>{partner.name}</b><small>{partner.id} · Registered {formatDate(partner.registeredAt, { month: 'short', year: 'numeric' })}</small></span></button></td>
            <td><span className="vehicle-cell"><Icon name={partner.vehicle === 'Van' ? 'van' : partner.vehicle === 'On foot' ? 'user' : 'bike'} size={16} />{partner.vehicle}</span></td>
            <td><span className="area-list">{partner.serviceAreas.slice(0, 2).join(', ')}{partner.serviceAreas.length > 2 && <small>+{partner.serviceAreas.length - 2} areas</small>}</span></td>
            <td><StatusBadge status={verificationState} /></td>
            <td><span className="availability-cell"><StatusBadge status={partner.availability} />{partner.availability === 'Suspended' && partner.suspendedUntil && <small>Until {formatSuspensionEnd(partner.suspendedUntil)}</small>}</span></td>
            <td>{assignedDelivery ? <button className="table-record-link" onClick={() => open(`/admin/deliveries/${assignedDelivery.id}`)}>{assignedDelivery.id}<small>{assignedDelivery.status}</small></button> : <span className="muted-text">None</span>}</td>
            <td><span className="eligibility-cell" title={eligibilityResult.reasons.join('\n')}><i className={eligibilityResult.eligible ? 'eligibility-ok' : 'eligibility-no'} />{eligibilityResult.eligible ? 'Eligible' : eligibilityResult.reasons[0] ?? 'Not eligible'}</span></td>
            <td><span className="row-action-group">{partner.availability === 'Suspended' || partner.availability === 'Restricted'
              ? <Button size="small" variant="primary" disabled={!canManage} title={canManage ? `Restore ${partner.name}` : 'Partner management access required'} onClick={() => setRestoreTarget(partner)}>Restore</Button>
              : <Button size="small" variant="danger" disabled={!canManage} title={canManage ? `Suspend ${partner.name}` : 'Partner management access required'} onClick={() => setSuspendTarget(partner)}>Suspend</Button>}<button className="row-open-button" onClick={() => open(`/admin/partners/${partner.id}`)} aria-label={`View ${partner.name} profile`}><Icon name="arrow" size={15} /></button></span></td>
          </tr>
        })}
      </tbody></table>{visible.length === 0 && <EmptyState title={data.partners.length === 0 && data.partnerAppRecords.length > 0 ? 'No local partner records yet' : 'No partners match these filters'} detail={data.partners.length === 0 && data.partnerAppRecords.length > 0 ? 'Approved delivery_app accounts are imported automatically on the next partner sync. Pending accounts must be approved in KYC Review first.' : 'Adjust the filters to view partners in the directory.'} />}</div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </Panel>
    <p className="overview-footnote"><Icon name="shield" size={14} />Personal and document details are visible only to authorized administrators. Unsynchronized fields are shown as not provided.</p>
    {suspendTarget && <SuspendPartnerDialog partnerName={suspendTarget.name} detail="Suspension blocks new assignments, is reflected in delivery_app immediately, and ends automatically after the selected number of days. Any active delivery is preserved and flagged for operations review." onCancel={() => setSuspendTarget(null)} onConfirm={(reason, durationDays) => { dispatch({ type: 'partner.restrict', partnerId: suspendTarget.id, status: 'Suspended', reason, durationDays }); setSuspendTarget(null) }} />}
    {restoreTarget && <ConfirmDialog title={`Restore ${restoreTarget.name}?`} detail="Reinstating removes the suspension and lets the partner receive new assignments again. Verification and any active delivery still affect eligibility." reasonLabel="Reinstatement reason" confirmLabel="Restore partner" onCancel={() => setRestoreTarget(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restore', partnerId: restoreTarget.id, reason }); setRestoreTarget(null) }} />}
  </div>
}

function DocumentDialog({ document, onClose }: { document: PartnerDocument; onClose: () => void }) {
  const { dispatch } = useOperations()
  const [status, setStatus] = useState<DocumentStatus>(displayedDocumentStatus(document))
  const [expiry, setExpiry] = useState(document.expiresAt ? new Date(document.expiresAt).toISOString().slice(0, 10) : '')
  const [reason, setReason] = useState(document.rejectionReason ?? '')
  const isRejected = status === 'Rejected'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const expiresAt = status === 'Expired'
      ? new Date(Date.now() - 60_000).toISOString()
      : expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null
    dispatch({ type: 'document.update', documentId: document.id, status, reason, expiresAt })
    onClose()
  }

  return <Dialog title={`Review ${document.type.toLowerCase()}`} onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>
      <p className="dialog-description">Illustrative document record <strong>{document.id}</strong>. No file upload or identity provider is connected.</p>
      <label className="field-label">Review status<select value={status} onChange={(event) => { const next = event.target.value as DocumentStatus; setStatus(next); if (next === 'Verified' && (!expiry || new Date(`${expiry}T23:59:59`).getTime() <= Date.now())) setExpiry(new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString().slice(0, 10)) }}><option>Missing</option><option>Submitted</option><option>Under Review</option><option>Verified</option><option>Rejected</option><option>Expired</option></select></label>
      {status !== 'Missing' && status !== 'Expired' && <label className="field-label">Expiry date <input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>}
      <label className="field-label">{isRejected ? 'Rejection reason (required)' : 'Reviewer note'}<textarea rows={3} maxLength={240} required={isRejected} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={isRejected ? 'Explain what needs correction' : 'Optional review note'} /></label>
      <div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Save review</Button></div>
    </form>
  </Dialog>
}

interface ProfileProps extends DirectoryProps { partnerId: string; initialDocumentId?: string | null }

export function PartnerProfilePage({ data, open, partnerId, initialDocumentId }: ProfileProps) {
  const { frame, dispatch } = useOperations()
  const partner = data.partners.find((item) => item.id === partnerId)
  const liveRecord = partner?.partnerAppUid
    ? data.partnerAppRecords.find((record) => record.id === partner.partnerAppUid)
    : undefined
  const liveFields = liveRecord?.fields ?? {}
  const liveValue = (...keys: string[]) => keys.map((key) => liveFields[key]).find((value) => value?.trim()) ?? null
  const [dialog, setDialog] = useState<'restrict' | 'suspend' | 'restore' | 'availability' | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId ?? null)
  const [documentFilter, setDocumentFilter] = useState('All')
  useEffect(() => setDocumentId(initialDocumentId ?? null), [initialDocumentId])
  if (!partner) return <EmptyState title="Partner not found" detail="This partner record may have been removed from local data." action={<Button onClick={() => open('/admin/partners')}>Back to partner directory</Button>} />

  const docs = data.documents.filter((document) => document.partnerId === partner.id)
  const liveDocumentRecord = partner.partnerAppUid
    ? data.partnerAppDocuments.find((document) => document.id === partner.partnerAppUid)
    : undefined
  const submittedLiveDocs = liveDocumentRecord
    ? liveDocumentRecord.files.filter((file) => Boolean(file.fileName || partnerDocumentNumber(file, liveRecord)))
    : []
  const liveSubmittedKeys = submittedLiveDocumentKeys(liveDocumentRecord, liveRecord)
  const missingLiveKeys = requiredLiveDocumentKeys(liveRecord?.vehicle ?? partner.vehicle)
    .filter((key) => !liveSubmittedKeys.includes(key))
  const filteredDocs = docs.filter((document) => documentFilter === 'All' || displayedDocumentStatus(document) === documentFilter)
  const assignments = data.assignments.filter((assignment) => assignment.partnerId === partner.id).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
  const active = getActiveAssignment(data, partner.id)
  const activeDelivery = active ? data.deliveries.find((delivery) => delivery.id === active.deliveryId) : undefined
  const history = data.partnerHistory.filter((event) => event.partnerId === partner.id).slice(0, 10)
  const verification = partnerVerification(data, partner)
  const liveApplicationApproved = Boolean(liveRecord) && verification === 'Verified'
  const canManage = userCan(frame.data.user, 'partner-management')
  const canReviewDocuments = userCan(frame.data.user, 'document-review')
  const document = documentId ? docs.find((item) => item.id === documentId) : undefined
  // The primary grid already shows these values; keeping them out of the
  // additional-fields grid avoids the duplicate profile sections.
  const primaryFieldKeys = new Set([
    'partnerId', 'fullName', 'name', 'phone', 'email',
    'vehicleType', 'type', 'model', 'colour', 'registrationNumber', 'licenceNumber',
    'vehicleModel', 'vehicleColour', 'vehicleRegistrationNumber', 'vehicleLicenceNumber',
    'addressLine', 'address', 'fullAddress', 'city', 'pincode', 'postalCode',
    'applicationStatus', 'status', 'availability', 'isOnline', 'lastSeen', 'lastSignInAt',
    'updatedAt', 'submittedAt', 'statusUpdatedAt', 'joinedOn', 'rating',
    'profilePhotoUrl', 'profilePhotoPath', 'lastLocation', 'lastLocationUpdatedAt',
  ])
  const additionalLiveFields = Object.entries(liveFields).filter(([key, value]) =>
    value.trim()
    && !/token|password|secret/i.test(key)
    && !primaryFieldKeys.has(key)
    && !key.startsWith('vehicle.'),
  )
  const expiringDocs = docs.filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() > Date.now() && new Date(item.expiresAt).getTime() < Date.now() + 30 * 24 * 60 * 60_000)
  const expiringLiveDocs = (liveDocumentRecord?.files ?? []).filter((file) => file.review?.expiresAt && new Date(file.review.expiresAt).getTime() > Date.now() && new Date(file.review.expiresAt).getTime() < Date.now() + 30 * 24 * 60 * 60_000)
  const suspensionWindow = suspensionTimeline(partner.suspensionDays, partner.suspendedUntil)

  return <div className="page-stack partner-profile-page">
    <Panel className="partner-profile-header">
      <div className="partner-profile-identity"><span className="profile-large-avatar">{initials(partner.name)}</span><div><div className="profile-name-line"><h2>{partner.name}</h2><StatusBadge status={partner.availability} /></div><p>{partner.id} <span>·</span> Registered {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(partner.registeredAt))} {liveRecord ? <><span>·</span> Live Firebase record</> : <><span>·</span> Not synchronized</>}</p><div className="masked-contact"><span><Icon name="user" size={14} />{liveRecord?.phone ?? partner.maskedPhone}</span><span>{liveRecord?.email ?? partner.maskedEmail}</span></div></div></div>
      <div className="partner-profile-actions"><Button size="small" onClick={() => open('/admin/partners')}><Icon name="arrow" size={14} className="icon-flip" />Directory</Button>{partner.availability === 'Restricted' || partner.availability === 'Suspended' ? <Button size="small" variant="primary" disabled={!canManage} onClick={() => setDialog('restore')}>Restore eligibility</Button> : <><Button size="small" disabled={!canManage || partner.availability === 'On Delivery'} onClick={() => setDialog('availability')}>{partner.availability === 'Offline' ? 'Set available' : 'Take offline'}</Button><Button size="small" variant="secondary" disabled={!canManage} onClick={() => setDialog('restrict')}>Restrict</Button><Button size="small" variant="danger" disabled={!canManage} onClick={() => setDialog('suspend')}>Suspend</Button></>}</div>
    </Panel>

    {(partner.availability === 'Restricted' || partner.availability === 'Suspended') && <div className="exception-banner"><Icon name="shield" size={17} /><div><strong>Partner is {partner.availability.toLowerCase()} and ineligible for new assignments</strong><span>{partner.restrictedReason ?? partner.suspendedReason}{suspensionWindow ? ` · ${suspensionWindow}` : ''}{partner.needsOperationalReview && activeDelivery ? ` · Existing ${activeDelivery.id} assignment needs operational review.` : ''}</span></div></div>}
    {(expiringDocs.length > 0 || expiringLiveDocs.length > 0) && <div className="soft-notice"><Icon name="clock" size={15} />{expiringDocs.length + expiringLiveDocs.length} document{expiringDocs.length + expiringLiveDocs.length === 1 ? '' : 's'} expire within 30 days.</div>}

    <div className="profile-columns">
      <div className="profile-main-column">
        <Panel><PanelHeading title="Partner and vehicle" detail={liveRecord ? 'Live synchronized partner details' : 'Live partner details are not synchronized'} />
          <div className="profile-data-grid"><div><span>Firebase UID</span><strong>{liveRecord?.id ?? 'Not linked'}</strong></div><div><span>Vehicle</span><strong><Icon name={partner.vehicle === 'Van' ? 'van' : partner.vehicle === 'On foot' ? 'user' : 'bike'} size={16} />{liveValue('vehicleType', 'vehicle.type') ?? partner.vehicle}</strong></div><div><span>Model</span><strong>{liveValue('vehicleModel', 'vehicle.model', 'model') ?? 'Not provided'}</strong></div><div><span>Colour</span><strong>{liveValue('vehicleColour', 'vehicle.color', 'colour', 'color') ?? 'Not provided'}</strong></div><div><span>Registration number</span><strong>{liveValue('vehicleRegistrationNumber', 'vehicle.registrationNumber', 'registrationNumber') ?? 'Not provided'}</strong></div><div><span>Licence number</span><strong>{liveValue('vehicleLicenceNumber', 'vehicle.licenceNumber', 'licenceNumber', 'licenseNumber') ?? 'Not provided'}</strong></div><div><span>Address</span><strong>{liveValue('addressLine', 'address', 'fullAddress') ?? 'Not provided'}</strong></div><div><span>City / pincode</span><strong>{[liveValue('city'), liveValue('pincode', 'postalCode')].filter(Boolean).join(' / ') || 'Not provided'}</strong></div><div><span>Application status</span><strong>{liveRecord?.applicationStatus ?? 'Not synchronized'}</strong></div><div><span>Account status</span><strong>{liveRecord?.status ?? 'Not synchronized'}</strong></div></div>
          {liveRecord && additionalLiveFields.length > 0 && <div className="submitted-fields"><strong>Additional submitted information</strong><div className="profile-data-grid">{additionalLiveFields.map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}</div></div>}
          <div className="illustrative-note"><Icon name="shield" size={14} />Only authorized administrators can view these personal and document details. Security tokens and secrets are excluded.</div>
        </Panel>

        <Panel className="document-panel">
          <PanelHeading
            title="KYC documents"
            detail={liveDocumentRecord ? 'Submitted from delivery_app · reviewed in KYC Review' : 'Admin document records'}
            action={docs.length > 0 ? <label className="inline-filter"><span className="sr-only">Filter document status</span><select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}><option>All</option><option>Missing</option><option>Submitted</option><option>Under Review</option><option>Verified</option><option>Rejected</option><option>Expired</option></select></label> : undefined}
          />
          {liveDocumentRecord && <>
            <div className="document-source-label">delivery_app submissions</div>
            <div className="document-list">{submittedLiveDocs.map((file) => {
              const number = partnerDocumentNumber(file, liveRecord)
              return <div className="document-row" key={`live-${file.key}`}>
                <span className={`document-icon document-${(file.review?.status ?? 'under-review').toLowerCase()}`}><Icon name="file" size={17} /></span>
                <div className="document-main">
                  <strong>{documentLabel(file.key)}<small>{file.fileName ?? 'Number on record'}</small></strong>
                  {number && <span>Number: {formatDocumentNumber(file.key, number)}</span>}
                </div>
                <div className="document-status">
                  <StatusBadge status={file.review?.status ?? 'Under Review'} />
                  {file.review?.expiresAt && <small>Expires {formatDate(file.review.expiresAt, { month: 'short', day: 'numeric', year: 'numeric' })}</small>}
                  {file.review?.note && <small>{file.review.note}</small>}
                </div>
                <div className="document-review-meta"><span>Reviewer</span><strong>{file.review?.reviewedBy ?? '—'}</strong><small>{file.review ? 'Reviewed' : 'Awaiting review'}</small></div>
                {file.downloadUrl ? <a className="text-link" href={file.downloadUrl} target="_blank" rel="noreferrer">Open file <Icon name="external" size={13} /></a> : <Button size="small" variant="quiet" onClick={() => open('/admin/kyc')}>Review in KYC</Button>}
              </div>
            })}{submittedLiveDocs.length === 0 && <EmptyState title="No documents submitted" detail="delivery_app has not submitted file or number details for this account yet." />}</div>
            {missingLiveKeys.length > 0 && <div className="soft-notice"><Icon name="alert" size={15} /><span>Missing required KYC: {missingLiveKeys.map(documentLabel).join(', ')}. Review and record these in KYC Review.</span></div>}
          </>}
          {docs.length > 0 && <>
            {liveDocumentRecord && <div className="document-source-label">Admin document records</div>}
            <div className="document-list">{filteredDocs.map((item) => <div className="document-row" key={item.id}>
              <span className={`document-icon document-${displayedDocumentStatus(item).toLowerCase().replace(' ', '-')}`}><Icon name="file" size={17} /></span><div className="document-main"><strong>{item.type}<small>{item.id} · {item.demoRecord ? 'Local record' : 'Record'}</small></strong><span>{item.submittedAt ? `Submitted ${formatDate(item.submittedAt, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No submission on record'}</span></div><div className="document-status"><StatusBadge status={displayedDocumentStatus(item)} />{item.expiresAt && <small>Expires {formatDate(item.expiresAt, { month: 'short', day: 'numeric', year: 'numeric' })}</small>}{item.rejectionReason && <small className="text-danger">{item.rejectionReason}</small>}</div><div className="document-review-meta"><span>Reviewer</span><strong>{item.reviewer ?? '—'}</strong><small>{item.history.length} review event{item.history.length === 1 ? '' : 's'}</small></div><Button size="small" disabled={!canReviewDocuments} onClick={() => setDocumentId(item.id)}>Review</Button>
            </div>)}{filteredDocs.length === 0 && <EmptyState title="No documents in this filter" detail="Choose another document status." />}</div>
          </>}
          {!liveDocumentRecord && docs.length === 0 && <EmptyState title="No KYC documents" detail="This partner has no local document records and is not linked to a delivery_app document record." />}
          <p className="demo-disclaimer-small">Document numbers are shown from the synchronized delivery_app record. File previews are unavailable when the partner app has not uploaded a file.</p>
        </Panel>

        <Panel><PanelHeading title="Delivery history" detail={`${assignments.length} assignment record${assignments.length === 1 ? '' : 's'} · retained across reassignments`} />
          {assignments.length ? <div className="partner-delivery-history">{assignments.map((assignment) => {
            const delivery = data.deliveries.find((item) => item.id === assignment.deliveryId)
            return <button className="partner-history-delivery" key={assignment.id} onClick={() => delivery && open(`/admin/deliveries/${delivery.id}`)}><span className="history-dot" /><span><strong>{assignment.deliveryId}<small>{delivery ? `${delivery.pickup} → ${delivery.drop}` : 'Delivery record unavailable'}</small></strong><small>{assignment.status} · {formatDate(assignment.assignedAt)}{assignment.releaseReason ? ` · ${assignment.releaseReason}` : ''}</small></span><StatusBadge status={delivery?.status ?? 'Unavailable'} /><Icon name="chevron" size={15} /></button>
          })}</div> : <p className="muted-copy">No delivery assignments yet.</p>}
        </Panel>
      </div>

      <aside className="profile-side-column">
        <Panel className="current-delivery-card"><PanelHeading title="Current assignment" detail={activeDelivery ? activeDelivery.id : 'Not on delivery'} />
          {activeDelivery ? <><button className="current-delivery-link" onClick={() => open(`/admin/deliveries/${activeDelivery.id}`)}><strong>{activeDelivery.pickup}<Icon name="arrow" size={13} />{activeDelivery.drop}</strong><small>{activeDelivery.packageSize} · {activeDelivery.status}</small><span>Open delivery <Icon name="arrow" size={13} /></span></button><div className="current-progress"><div><span>Milestone progress</span><strong>{activeDelivery.milestones.filter((item) => item.completedAt).length}/6</strong></div><div className="mini-progress"><i style={{ width: `${activeDelivery.milestones.filter((item) => item.completedAt).length / 6 * 100}%` }} /></div></div>{partner.needsOperationalReview && <div className="review-flag"><Icon name="alert" size={14} />Operational review required</div>}</> : <div className="not-assigned-copy"><Icon name="route" size={19} /><strong>No active delivery</strong><small>Availability: {partner.availability}</small></div>}
        </Panel>

        <Panel><PanelHeading title="Partner activity" detail="Recent recorded history" />{history.length ? <div className="partner-timeline">{history.map((event) => <div className="partner-timeline-item" key={event.id}><i /><div><strong>{event.type}</strong><span>{event.description}</span><small>{formatDate(event.at)} · {event.actor}</small></div></div>)}</div> : <p className="muted-copy">Partner actions will be recorded here.</p>}</Panel>
        <Panel><PanelHeading title="Verification and eligibility" /><div className="eligibility-summary"><div><span>Verification</span><strong><StatusBadge status={verification} /></strong></div><div><span>KYC documents</span><strong>{liveApplicationApproved ? 'Approved in KYC Review' : liveDocumentRecord ? `${liveSubmittedKeys.length} submitted · ${missingLiveKeys.length} missing` : `${docs.filter((item) => data.settings.requiredDocuments.includes(item.type) && isDocumentCurrent(item)).length}/${data.settings.requiredDocuments.length} valid`}</strong></div><div><span>Active assignment</span><strong>{activeDelivery?.id ?? 'None'}</strong></div><div><span>Restriction / suspension</span><strong>{partner.availability === 'Suspended' && partner.suspendedUntil ? `Suspended until ${formatSuspensionEnd(partner.suspendedUntil)}` : partner.availability === 'Restricted' || partner.availability === 'Suspended' ? partner.availability : 'None'}</strong></div></div><button className="text-link" onClick={() => liveDocumentRecord ? open('/admin/kyc') : open('/admin/deliveries')}>{liveDocumentRecord ? 'Review KYC documents' : 'Review delivery queue'} <Icon name="arrow" size={14} /></button></Panel>
      </aside>
    </div>

    {dialog === 'restrict' && <ConfirmDialog title={`Restrict ${partner.name}?`} detail="Restriction blocks new assignments and offers. Any active assignment is preserved and flagged for operational review." confirmLabel="Restrict partner" danger onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restrict', partnerId: partner.id, status: 'Restricted', reason }); setDialog(null) }} />}
    {dialog === 'suspend' && <SuspendPartnerDialog partnerName={partner.name} detail="Suspension blocks new assignments and offers. Existing delivery assignment and history remain in place for an operations review, and eligibility returns automatically when the timeline ends." onCancel={() => setDialog(null)} onConfirm={(reason, durationDays) => { dispatch({ type: 'partner.restrict', partnerId: partner.id, status: 'Suspended', reason, durationDays }); setDialog(null) }} />}
    {dialog === 'restore' && <ConfirmDialog title={`Restore ${partner.name}?`} detail="Restoring removes the restriction/suspension. Document checks and any existing assignment still affect eligibility." reasonLabel="Restoration reason" confirmLabel="Restore partner" onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restore', partnerId: partner.id, reason }); setDialog(null) }} />}
    {dialog === 'availability' && <ConfirmDialog title={partner.availability === 'Offline' ? 'Set partner available?' : 'Take partner offline?'} detail="Availability changes are saved to the partner history. An active delivery cannot be marked available." reasonLabel="Operational note" confirmLabel={partner.availability === 'Offline' ? 'Set available' : 'Take offline'} onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.availability', partnerId: partner.id, availability: partner.availability === 'Offline' ? 'Available' : 'Offline', reason }); setDialog(null) }} />}
    {document && <DocumentDialog key={document.id} document={document} onClose={() => setDocumentId(null)} />}
  </div>
}

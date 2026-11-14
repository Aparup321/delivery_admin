import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { DocumentStatus, OperationsState, Partner, PartnerAppRecord, PartnerDocument } from '../domain/model'
import { getActiveAssignment, getPartnerEligibility, isDocumentCurrent } from '../domain/operations'
import { Button, ConfirmDialog, Dialog, EmptyState, formatDate, Icon, initials, Panel, PanelHeading, StatusBadge } from '../components/ui'
import { useOperations } from '../state/OperationsProvider'
import { partnerAppEndpoint } from '../services/partnerApp'
import { ApplicationsPage } from './ApplicationsPage'

interface DirectoryProps {
  data: OperationsState
  open: (path: string) => void
  viewFromUrl?: string
}

function displayedDocumentStatus(document: PartnerDocument): DocumentStatus {
  if (document.status === 'Verified' && document.expiresAt && new Date(document.expiresAt).getTime() <= Date.now()) return 'Expired'
  return document.status
}

function partnerVerification(data: OperationsState, partner: Partner) {
  const mandatory = data.settings.requiredDocuments.map((type) => data.documents.find((document) => document.partnerId === partner.id && document.type === type))
  if (mandatory.every((document) => document && isDocumentCurrent(document))) return 'Verified'
  if (mandatory.some((document) => document && ['Rejected', 'Expired'].includes(displayedDocumentStatus(document)))) return 'Attention Required'
  if (mandatory.some((document) => document && ['Under Review', 'Submitted'].includes(displayedDocumentStatus(document)))) return 'Under Review'
  return 'Incomplete'
}

function PartnerSectionTabs({ active, data, open }: { active: 'directory' | 'app' | 'activity' | 'kyc'; data: OperationsState; open: (path: string) => void }) {
  const reviewCount = data.documents.filter((document) => displayedDocumentStatus(document) !== 'Verified').length
  const pendingApplications = data.applications.filter((application) => application.status === 'Submitted').length
  const attentionCount = reviewCount + pendingApplications
  return <div className="partner-section-tabs"><button className={active === 'directory' ? 'active' : ''} onClick={() => open('/admin/partners')}>Partner directory<span>{data.partners.length}</span></button><button className={active === 'app' ? 'active' : ''} onClick={() => open('/admin/partners?view=app')}>Partner app<span>{data.partnerAppRecords.length}</span></button><button className={active === 'activity' ? 'active' : ''} onClick={() => open('/admin/partners?view=activity')}>Partner activity<span>{data.partnerHistory.length}</span></button><button className={active === 'kyc' ? 'active' : ''} onClick={() => open('/admin/kyc')}>KYC review<span className={attentionCount ? 'tab-attention-count' : ''}>{attentionCount}</span></button></div>
}

function KycReviewPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame } = useOperations()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Needs review')
  const [documentType, setDocumentType] = useState('All')
  const [page, setPage] = useState(1)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const pageSize = 10
  const filtered = useMemo(() => data.documents.filter((document) => {
    const partner = data.partners.find((item) => item.id === document.partnerId)
    const currentStatus = displayedDocumentStatus(document)
    const query = search.trim().toLowerCase()
    return (status === 'All' || (status === 'Needs review' ? currentStatus !== 'Verified' : currentStatus === status))
      && (documentType === 'All' || document.type === documentType)
      && (!query || `${document.id} ${document.partnerId} ${partner?.name ?? ''} ${document.type} ${document.rejectionReason ?? ''}`.toLowerCase().includes(query))
  }).sort((a, b) => {
    const priority = (item: PartnerDocument) => ['Missing', 'Expired', 'Rejected', 'Submitted', 'Under Review', 'Verified'].indexOf(displayedDocumentStatus(item))
    const difference = priority(a) - priority(b)
    return difference || (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999')
  }), [data.documents, data.partners, search, status, documentType])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const reviewDocument = documentId ? data.documents.find((item) => item.id === documentId) : undefined
  const canReview = ['Admin', 'Operations Manager'].includes(frame.data.user.role)

  return <>
    <Panel className="records-panel kyc-queue-panel">
    <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>document records</span><span className="dot-separator" />Review from one queue</div><span className="demo-caption">Illustrative KYC records · no real files or identity checks</span></div>
    <div className="filter-toolbar kyc-filter-toolbar"><label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search partner, document, or reason" aria-label="Search KYC records" /></label><label className="filter-control"><span>Review status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option>Needs review</option><option>All</option><option>Missing</option><option>Submitted</option><option>Under Review</option><option>Rejected</option><option>Expired</option><option>Verified</option></select></label><label className="filter-control"><span>Document type</span><select value={documentType} onChange={(event) => { setDocumentType(event.target.value); setPage(1) }}><option>All</option>{[...new Set(data.documents.map((item) => item.type))].map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <div className="table-scroll"><table className="data-table kyc-table"><thead><tr><th>Partner</th><th>Document</th><th>Status</th><th>Submitted</th><th>Expiry</th><th>Reviewer / issue</th><th>Requirement</th><th>Actions</th></tr></thead><tbody>
      {visible.map((document) => {
        const partner = data.partners.find((item) => item.id === document.partnerId)
        const currentStatus = displayedDocumentStatus(document)
        const mandatory = data.settings.requiredDocuments.includes(document.type)
        return <tr key={document.id}>
          <td><button className="partner-cell partner-profile-button" onClick={() => open(`/admin/partners/${document.partnerId}`)}><span className="mini-avatar">{initials(partner?.name ?? document.partnerId)}</span><span><b>{partner?.name ?? 'Unknown partner'}</b><small>{document.partnerId}</small></span></button></td>
          <td><span className="kyc-document-name"><strong>{document.type}</strong><small>{document.id}</small></span></td>
          <td><StatusBadge status={currentStatus} /></td>
          <td>{document.submittedAt ? formatDate(document.submittedAt, { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="muted-text">No submission</span>}</td>
          <td>{document.expiresAt ? formatDate(document.expiresAt, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
          <td><span className={document.rejectionReason ? 'kyc-issue-text' : 'kyc-reviewer-text'}>{document.rejectionReason ?? document.reviewer ?? (currentStatus === 'Missing' ? 'No record submitted' : 'Awaiting reviewer')}</span></td>
          <td>{mandatory ? <span className="required-tag">MANDATORY</span> : <span className="muted-text">Optional</span>}</td>
          <td><Button size="small" variant={canReview ? 'secondary' : 'quiet'} disabled={!canReview} title={canReview ? 'Review this KYC document' : 'Administrator access required'} onClick={() => setDocumentId(document.id)}>{canReview ? 'Review' : 'View record'}</Button></td>
        </tr>
      })}
    </tbody></table>{visible.length === 0 && <EmptyState title="No KYC records match" detail="Adjust status or document type filters. Verified records are excluded by the default Needs review filter." />}</div>
    <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    <div className="notification-history-note"><Icon name="shield" size={14} />Review actions update the partner document, eligibility, notifications, verification history, and audit log together.</div>
    </Panel>
    {reviewDocument && <DocumentDialog key={reviewDocument.id} document={reviewDocument} onClose={() => setDocumentId(null)} />}
  </>
}

function PartnerAppRecordDialog({ record, linkedPartner, onClose, open }: { record: PartnerAppRecord; linkedPartner: Partner | undefined; onClose: () => void; open: (path: string) => void }) {
  const entries = Object.entries(record.fields).sort(([a], [b]) => a.localeCompare(b))
  return <Dialog title={`Partner app record ${record.id}`} eyebrow="PARTNER APP DATA" wide onClose={onClose}>
    <div className="app-record-detail">
      <div className="app-record-head"><span className="mini-avatar">{initials(record.name)}</span><div><strong>{record.name}</strong><small>{record.id} · synced {formatDate(record.syncedAt)}</small></div>{linkedPartner && <StatusBadge status={`Linked · ${linkedPartner.id}`} />}</div>
      <div className="app-record-grid"><div><span>Partner ID</span><strong>{record.partnerId ?? '—'}</strong></div><div><span>Phone</span><strong>{record.phone ?? '—'}</strong></div><div><span>Email</span><strong>{record.email ?? '—'}</strong></div><div><span>Vehicle</span><strong>{record.vehicle ?? '—'}</strong></div><div><span>App status</span><strong>{record.status ?? '—'}</strong></div><div><span>Service areas</span><strong>{record.serviceAreas.length ? record.serviceAreas.join(', ') : '—'}</strong></div></div>
      <div className="app-record-fields"><span className="app-record-fields-label">Raw delivery_app fields</span>{entries.length ? entries.map(([key, value]) => <div className="app-record-field" key={key}><span>{key}</span><strong>{value}</strong></div>) : <p className="muted-copy">No fields were returned for this record.</p>}</div>
      <div className="dialog-actions"><Button onClick={onClose}>Close</Button>{linkedPartner && <Button variant="primary" onClick={() => { onClose(); open(`/admin/partners/${linkedPartner.id}`) }}>Open admin profile</Button>}</div>
    </div>
  </Dialog>
}

function PartnerAppDataPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [recordId, setRecordId] = useState<string | null>(null)
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
    return !query || [record.id, record.partnerId ?? '', record.name, record.phone ?? '', record.email ?? '', record.vehicle ?? '', record.status ?? '', ...record.serviceAreas].join(' ').toLowerCase().includes(query)
  }).sort((a, b) => (b.updatedAt ?? b.syncedAt).localeCompare(a.updatedAt ?? a.syncedAt)), [data.partnerAppRecords, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const record = recordId ? data.partnerAppRecords.find((item) => item.id === recordId) : undefined
  const linkedPartner = record ? data.partners.find((partner) => partner.id === record.partnerId || partner.id === record.id) : undefined

  return <>
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>partner app records</span><span className="dot-separator" />{config.lastSyncAt ? `Synced ${formatDate(config.lastSyncAt)}` : 'Never synced'}</div><Button size="small" onClick={() => open('/admin/settings?tab=partner-app')}><Icon name="settings" size={14} />Connection settings</Button></div>
      {!configured ? <EmptyState title="Partner app not connected" detail="Enter the delivery_admin Firebase config (same project as delivery_app) in Settings → Partner app, then sync partner records." action={<Button variant="primary" onClick={() => open('/admin/settings?tab=partner-app')}>Configure partner app</Button>} /> : <>
        {config.lastError && <div className="soft-notice"><Icon name="alert" size={15} /><span className="partner-app-notice-copy">Last partner app request failed: {config.lastError}{requestUrl && <small className="partner-app-error-url">Request: {requestUrl}</small>}</span></div>}
        {data.partnerAppRecords.length === 0 ? <EmptyState title="No partner app records synced" detail="Run Sync partner data from Settings → Partner app. Records returned by delivery_app appear here after a successful sync." action={<Button variant="primary" onClick={() => open('/admin/settings?tab=partner-app')}>Open connection settings</Button>} /> : <>
          <div className="filter-toolbar kyc-filter-toolbar"><label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search record, partner ID, contact, vehicle, or status" aria-label="Search partner app records" /></label></div>
          <div className="table-scroll"><table className="data-table app-data-table"><thead><tr><th>App record</th><th>Contact</th><th>Vehicle</th><th>App status</th><th>Service areas</th><th>Admin partner</th><th>Updated</th><th /></tr></thead><tbody>
            {visible.map((item) => {
              const partner = data.partners.find((candidate) => candidate.id === item.partnerId || candidate.id === item.id)
              return <tr key={item.id}>
                <td><span className="partner-cell"><span className="mini-avatar">{initials(item.name)}</span><span><b>{item.name}</b><small>{item.id}</small></span></span></td>
                <td><span className="application-documents"><strong>{item.phone ?? 'No phone'}</strong><small>{item.email ?? 'No email'}</small></span></td>
                <td>{item.vehicle ?? <span className="muted-text">—</span>}</td>
                <td>{item.status ? <StatusBadge status={item.status} /> : <span className="muted-text">—</span>}</td>
                <td><span className="area-list">{item.serviceAreas.slice(0, 2).join(', ') || '—'}{item.serviceAreas.length > 2 && <small>+{item.serviceAreas.length - 2} areas</small>}</span></td>
                <td>{partner ? <button className="table-record-link" onClick={() => open(`/admin/partners/${partner.id}`)}>{partner.id}<small>{partner.name}</small></button> : <span className="muted-text">Not linked</span>}</td>
                <td>{formatDate(item.updatedAt ?? item.syncedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td><Button size="small" onClick={() => setRecordId(item.id)}>Details</Button></td>
              </tr>
            })}
          </tbody></table>{visible.length === 0 && <EmptyState title="No matching partner app records" detail="Adjust the search to find a synced delivery_app record." />}</div>
          <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
        </>}
        <div className="notification-history-note"><Icon name="shield" size={14} />Read-only cache of delivery_app records. Data refreshes only when an Administrator runs a sync from Settings → Partner app.</div>
      </>}
    </Panel>
    {record && <PartnerAppRecordDialog record={record} linkedPartner={linkedPartner} onClose={() => setRecordId(null)} open={open} />}
  </>
}

function PartnerActivityPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame, dispatch } = useOperations()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('All')
  const [page, setPage] = useState(1)
  const [suspendTarget, setSuspendTarget] = useState<Partner | null>(null)
  const pageSize = 10
  const canManage = frame.data.user.role === 'Admin'
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
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>partner activity events</span><span className="dot-separator" />{data.partners.filter((partner) => partner.availability === 'Suspended').length} suspended partners</div><span className="demo-caption">Recorded from local demo workflows</span></div>
      <div className="filter-toolbar kyc-filter-toolbar"><label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search partner, activity, detail, or operator" aria-label="Search partner activity" /></label><label className="filter-control"><span>Activity type</span><select value={type} onChange={(event) => { setType(event.target.value); setPage(1) }}><option>All</option>{types.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className="table-scroll"><table className="data-table activity-table"><thead><tr><th>Partner</th><th>Activity</th><th>Details</th><th>Related record</th><th>Recorded by</th><th>When</th><th /></tr></thead><tbody>
        {visible.map((event) => {
          const partner = data.partners.find((item) => item.id === event.partnerId)
          const relatedDelivery = event.relatedDeliveryId ? data.deliveries.find((delivery) => delivery.id === event.relatedDeliveryId) : undefined
          return <tr key={event.id}>
            <td>{partner ? <button className="partner-cell partner-profile-button" onClick={() => open(`/admin/partners/${partner.id}`)}><span className="mini-avatar">{initials(partner.name)}</span><span><b>{partner.name}</b><small>{partner.id} · {partner.availability}</small></span></button> : <span className="muted-text">{event.partnerId}</span>}</td>
            <td><span className="activity-event">{event.type}</span></td>
            <td><span className="activity-detail">{event.description}</span></td>
            <td>{relatedDelivery ? <button className="table-record-link" onClick={() => open(`/admin/deliveries/${relatedDelivery.id}`)}>{relatedDelivery.id}<small>{relatedDelivery.status}</small></button> : <span className="muted-text">—</span>}</td>
            <td>{event.actor}</td>
            <td>{formatDate(event.at, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td>{partner ? <Button size="small" variant="danger" disabled={!canManage || partner.availability === 'Suspended'} title={partner.availability === 'Suspended' ? 'Partner is already suspended' : canManage ? undefined : 'Administrator access required'} onClick={() => setSuspendTarget(partner)}>Suspend</Button> : <span className="muted-text">—</span>}</td>
          </tr>
        })}
      </tbody></table>{visible.length === 0 && <EmptyState title="No partner activity matches" detail="Adjust the activity type or search filters. Activity is recorded as partner actions occur." />}</div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
      <div className="notification-history-note"><Icon name="shield" size={14} />Only an Administrator can suspend a partner. Suspensions block new assignments and are recorded in partner activity and the audit log.</div>
    </Panel>
    {suspendTarget && <ConfirmDialog title={`Suspend ${suspendTarget.name}?`} detail="Suspension blocks new assignments and offers. Existing delivery assignments and history are retained for an operations review." reasonLabel="Suspension reason" confirmLabel="Suspend partner" danger onCancel={() => setSuspendTarget(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restrict', partnerId: suspendTarget.id, status: 'Suspended', reason }); setSuspendTarget(null) }} />}
  </>
}

function VerificationPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const pendingApplications = data.applications.filter((application) => application.status === 'Submitted').length
  const approvedApplications = data.applications.filter((application) => application.status === 'Approved').length
  const pendingDocuments = data.documents.filter((document) => displayedDocumentStatus(document) !== 'Verified').length
  const flaggedDocuments = data.documents.filter((document) => ['Expired', 'Rejected'].includes(displayedDocumentStatus(document))).length

  return <div className="page-stack verification-page">
    <Panel className="verification-overview">
      <div className="verification-overview-copy"><span className="eyebrow">PARTNER VERIFICATION</span><h2>KYC review workspace</h2><p>Approve partner KYC applications and verify submitted documents from one queue.</p></div>
      <div className="verification-stat-grid">
        <div><span className="kyc-summary-icon kyc-icon-orange"><Icon name="clock" size={16} /></span><span><strong>{pendingApplications}</strong><small>Applications awaiting</small></span></div>
        <div><span className="kyc-summary-icon kyc-icon-green"><Icon name="check-circle" size={16} /></span><span><strong>{approvedApplications}</strong><small>Applications approved</small></span></div>
        <div><span className="kyc-summary-icon kyc-icon-purple"><Icon name="file" size={16} /></span><span><strong>{pendingDocuments}</strong><small>Documents to review</small></span></div>
        <div><span className="kyc-summary-icon kyc-icon-red"><Icon name="alert" size={16} /></span><span><strong>{flaggedDocuments}</strong><small>Expired or rejected</small></span></div>
      </div>
    </Panel>
    <div className="verification-section"><div><span>ONBOARDING</span><strong>Partner KYC applications</strong><small>Approve to onboard, or reject with a recorded reason.</small></div><span className="verification-section-badge">{pendingApplications} awaiting</span></div>
    <ApplicationsPage data={data} open={open} />
    <div className="verification-section"><div><span>DOCUMENT CHECKS</span><strong>Partner KYC documents</strong><small>Review identity, driving licence, and vehicle records without leaving this queue.</small></div><span className="verification-section-badge">{pendingDocuments} to review</span></div>
    <KycReviewPage data={data} open={open} />
  </div>
}

export function PartnersPage({ data, open, viewFromUrl }: DirectoryProps) {
  const [view, setView] = useState<'directory' | 'app' | 'activity' | 'kyc'>(viewFromUrl === 'kyc' || viewFromUrl === 'applications' ? 'kyc' : viewFromUrl === 'app' ? 'app' : viewFromUrl === 'activity' ? 'activity' : 'directory')
  const [search, setSearch] = useState('')
  const [availability, setAvailability] = useState('All')
  const [vehicle, setVehicle] = useState('All')
  const [area, setArea] = useState('All')
  const [verification, setVerification] = useState('All')
  const [eligibility, setEligibility] = useState('All')
  const [page, setPage] = useState(1)
  const pageSize = 8
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

  useEffect(() => { setView(viewFromUrl === 'kyc' || viewFromUrl === 'applications' ? 'kyc' : viewFromUrl === 'app' ? 'app' : viewFromUrl === 'activity' ? 'activity' : 'directory') }, [viewFromUrl])

  if (view === 'kyc') return <div className="page-stack"><PartnerSectionTabs active="kyc" data={data} open={open} /><VerificationPage data={data} open={open} /></div>
  if (view === 'app') return <div className="page-stack"><PartnerSectionTabs active="app" data={data} open={open} /><PartnerAppDataPage data={data} open={open} /></div>
  if (view === 'activity') return <div className="page-stack"><PartnerSectionTabs active="activity" data={data} open={open} /><PartnerActivityPage data={data} open={open} /></div>

  return <div className="page-stack">
    <PartnerSectionTabs active="directory" data={data} open={open} />
    <Panel className="records-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>delivery partners</span><span className="dot-separator" />{data.partners.filter((item) => item.availability === 'Available').length} available now</div><span className="demo-caption">Eligibility is contextual to the current demo queue</span></div>
      <div className="filter-toolbar partner-filter-toolbar">
        <label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search name, partner ID, vehicle, area" aria-label="Search delivery partners" /></label>
        <label className="filter-control"><span>Availability</span><select value={availability} onChange={(event) => { setAvailability(event.target.value); setPage(1) }}><option>All</option><option>Available</option><option>On Delivery</option><option>Offline</option><option>Restricted</option><option>Suspended</option></select></label>
        <label className="filter-control"><span>Vehicle</span><select value={vehicle} onChange={(event) => { setVehicle(event.target.value); setPage(1) }}><option>All</option><option>Bike</option><option>Scooter</option><option>Van</option></select></label>
        <label className="filter-control"><span>Service area</span><select value={area} onChange={(event) => { setArea(event.target.value); setPage(1) }}><option>All</option>{areas.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="filter-control"><span>Verification</span><select value={verification} onChange={(event) => { setVerification(event.target.value); setPage(1) }}><option>All</option><option>Verified</option><option>Incomplete</option><option>Under Review</option><option>Attention Required</option></select></label>
        <label className="filter-control"><span>Eligibility</span><select value={eligibility} onChange={(event) => { setEligibility(event.target.value); setPage(1) }}><option>All</option><option>Eligible</option><option>Ineligible</option></select></label>
      </div>
      <div className="table-scroll"><table className="data-table partner-table"><thead><tr><th>Partner</th><th>Vehicle</th><th>Service area</th><th>Verification</th><th>Availability</th><th>Current assignment</th><th>Eligibility</th><th /></tr></thead><tbody>
        {visible.map((partner) => {
          const active = getActiveAssignment(data, partner.id)
          const assignedDelivery = active ? data.deliveries.find((delivery) => delivery.id === active.deliveryId) : undefined
          const verificationState = partnerVerification(data, partner)
          const eligibilityResult = deliveryForEligibility ? getPartnerEligibility(data, partner, deliveryForEligibility) : { eligible: partner.availability === 'Available', reasons: [] }
          return <tr key={partner.id}>
            <td><button className="partner-cell partner-profile-button" onClick={() => open(`/admin/partners/${partner.id}`)}><span className="mini-avatar">{initials(partner.name)}</span><span><b>{partner.name}</b><small>{partner.id} · Registered {formatDate(partner.registeredAt, { month: 'short', year: 'numeric' })}</small></span></button></td>
            <td><span className="vehicle-cell"><Icon name={partner.vehicle === 'Bike' ? 'bike' : partner.vehicle === 'Van' ? 'van' : 'scooter'} size={16} />{partner.vehicle}</span></td>
            <td><span className="area-list">{partner.serviceAreas.slice(0, 2).join(', ')}{partner.serviceAreas.length > 2 && <small>+{partner.serviceAreas.length - 2} areas</small>}</span></td>
            <td><StatusBadge status={verificationState} /></td>
            <td><StatusBadge status={partner.availability} /></td>
            <td>{assignedDelivery ? <button className="table-record-link" onClick={() => open(`/admin/deliveries/${assignedDelivery.id}`)}>{assignedDelivery.id}<small>{assignedDelivery.status}</small></button> : <span className="muted-text">None</span>}</td>
            <td><span className="eligibility-cell" title={eligibilityResult.reasons.join('\n')}><i className={eligibilityResult.eligible ? 'eligibility-ok' : 'eligibility-no'} />{eligibilityResult.eligible ? 'Eligible' : eligibilityResult.reasons[0] ?? 'Not eligible'}</span></td>
            <td><button className="row-open-button" onClick={() => open(`/admin/partners/${partner.id}`)} aria-label={`View ${partner.name} profile`}><Icon name="arrow" size={15} /></button></td>
          </tr>
        })}
      </tbody></table>{visible.length === 0 && <EmptyState title="No partners match these filters" detail="Adjust the filters to view partners in the demo directory." />}</div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </Panel>
    <p className="overview-footnote"><Icon name="shield" size={14} />Contact details, registration details, and all verification documents are illustrative and masked. Off-duty locations are not collected or displayed.</p>
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
  const [dialog, setDialog] = useState<'restrict' | 'suspend' | 'restore' | 'availability' | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId ?? null)
  const [documentFilter, setDocumentFilter] = useState('All')
  useEffect(() => setDocumentId(initialDocumentId ?? null), [initialDocumentId])
  if (!partner) return <EmptyState title="Partner not found" detail="This partner record may have been removed from the local demo data." action={<Button onClick={() => open('/admin/partners')}>Back to partner directory</Button>} />

  const docs = data.documents.filter((document) => document.partnerId === partner.id)
  const filteredDocs = docs.filter((document) => documentFilter === 'All' || displayedDocumentStatus(document) === documentFilter)
  const assignments = data.assignments.filter((assignment) => assignment.partnerId === partner.id).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
  const active = getActiveAssignment(data, partner.id)
  const activeDelivery = active ? data.deliveries.find((delivery) => delivery.id === active.deliveryId) : undefined
  const history = data.partnerHistory.filter((event) => event.partnerId === partner.id).slice(0, 10)
  const verification = partnerVerification(data, partner)
  const canManage = ['Admin', 'Operations Manager'].includes(frame.data.user.role)
  const document = documentId ? docs.find((item) => item.id === documentId) : undefined
  const expiringDocs = docs.filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() > Date.now() && new Date(item.expiresAt).getTime() < Date.now() + 30 * 24 * 60 * 60_000)

  return <div className="page-stack partner-profile-page">
    <Panel className="partner-profile-header">
      <div className="partner-profile-identity"><span className="profile-large-avatar">{initials(partner.name)}</span><div><div className="profile-name-line"><h2>{partner.name}</h2><StatusBadge status={partner.availability} /></div><p>{partner.id} <span>·</span> Registered {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(partner.registeredAt))} <span>·</span> Illustrative profile</p><div className="masked-contact"><span><Icon name="user" size={14} />{partner.maskedPhone}</span><span>{partner.maskedEmail}</span></div></div></div>
      <div className="partner-profile-actions"><Button size="small" onClick={() => open('/admin/partners')}><Icon name="arrow" size={14} className="icon-flip" />Directory</Button>{partner.availability === 'Restricted' || partner.availability === 'Suspended' ? <Button size="small" variant="primary" disabled={!canManage} onClick={() => setDialog('restore')}>Restore eligibility</Button> : <><Button size="small" disabled={!canManage || partner.availability === 'On Delivery'} onClick={() => setDialog('availability')}>{partner.availability === 'Offline' ? 'Set available' : 'Take offline'}</Button><Button size="small" variant="secondary" disabled={!canManage} onClick={() => setDialog('restrict')}>Restrict</Button><Button size="small" variant="danger" disabled={!canManage} onClick={() => setDialog('suspend')}>Suspend</Button></>}</div>
    </Panel>

    {(partner.availability === 'Restricted' || partner.availability === 'Suspended') && <div className="exception-banner"><Icon name="shield" size={17} /><div><strong>Partner is {partner.availability.toLowerCase()} and ineligible for new assignments</strong><span>{partner.restrictedReason ?? partner.suspendedReason}{partner.needsOperationalReview && activeDelivery ? ` · Existing ${activeDelivery.id} assignment needs operational review.` : ''}</span></div></div>}
    {expiringDocs.length > 0 && <div className="soft-notice"><Icon name="clock" size={15} />{expiringDocs.length} document{expiringDocs.length === 1 ? '' : 's'} expire within 30 days.</div>}

    <div className="profile-columns">
      <div className="profile-main-column">
        <Panel><PanelHeading title="Partner and vehicle" detail="Sensitive registration data masked" />
          <div className="profile-data-grid"><div><span>Partner ID</span><strong>{partner.id}</strong></div><div><span>Vehicle</span><strong><Icon name={partner.vehicle === 'Bike' ? 'bike' : partner.vehicle === 'Van' ? 'van' : 'scooter'} size={16} />{partner.vehicle}</strong></div><div><span>Registration details</span><strong>{partner.maskedRegistration}</strong></div><div><span>Service areas</span><strong>{partner.serviceAreas.join(', ')}</strong></div><div><span>Verification</span><strong><StatusBadge status={verification} /></strong></div><div><span>Assignment eligibility</span><strong><StatusBadge status={partner.availability === 'Restricted' || partner.availability === 'Suspended' || verification !== 'Verified' || active ? 'Ineligible' : 'Eligible'} /></strong></div></div>
          <div className="illustrative-note"><Icon name="info" size={14} />No off-duty partner location is collected or shown. Contact and vehicle identifiers are masked demo values.</div>
        </Panel>

        <Panel className="document-panel"><PanelHeading title="Verification documents" detail="Individual illustrative records · mandatory documents must be valid" action={<label className="inline-filter"><span className="sr-only">Filter document status</span><select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}><option>All</option><option>Missing</option><option>Submitted</option><option>Under Review</option><option>Verified</option><option>Rejected</option><option>Expired</option></select></label>} />
          <div className="document-list">{filteredDocs.map((item) => <div className="document-row" key={item.id}>
            <span className={`document-icon document-${displayedDocumentStatus(item).toLowerCase().replace(' ', '-')}`}><Icon name="file" size={17} /></span><div className="document-main"><strong>{item.type}<small>{item.id} · {item.demoRecord ? 'Demo record' : 'Record'}</small></strong><span>{item.submittedAt ? `Submitted ${formatDate(item.submittedAt, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No submission on record'}</span></div><div className="document-status"><StatusBadge status={displayedDocumentStatus(item)} />{item.expiresAt && <small>Expires {formatDate(item.expiresAt, { month: 'short', day: 'numeric', year: 'numeric' })}</small>}{item.rejectionReason && <small className="text-danger">{item.rejectionReason}</small>}</div><div className="document-review-meta"><span>Reviewer</span><strong>{item.reviewer ?? '—'}</strong><small>{item.history.length} review event{item.history.length === 1 ? '' : 's'}</small></div><Button size="small" disabled={!canManage} onClick={() => setDocumentId(item.id)}>Review</Button>
          </div>)}{filteredDocs.length === 0 && <EmptyState title="No documents in this filter" detail="Choose another document status." />}</div>
          <p className="demo-disclaimer-small">Demo only: no real files, identity checks, or document verification provider are connected.</p>
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
        <Panel><PanelHeading title="Eligibility summary" /><div className="eligibility-summary"><div><span>Mandatory documents</span><strong>{docs.filter((item) => data.settings.requiredDocuments.includes(item.type) && isDocumentCurrent(item)).length}/{data.settings.requiredDocuments.length} valid</strong></div><div><span>Active assignment</span><strong>{activeDelivery?.id ?? 'None'}</strong></div><div><span>Restriction / suspension</span><strong>{partner.availability === 'Restricted' || partner.availability === 'Suspended' ? partner.availability : 'None'}</strong></div><div><span>Vehicle</span><strong>{partner.vehicle}</strong></div></div><button className="text-link" onClick={() => open('/admin/deliveries')}>Review delivery queue <Icon name="arrow" size={14} /></button></Panel>
      </aside>
    </div>

    {dialog === 'restrict' && <ConfirmDialog title={`Restrict ${partner.name}?`} detail="Restriction blocks new assignments and offers. Any active assignment is preserved and flagged for operational review." confirmLabel="Restrict partner" danger onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restrict', partnerId: partner.id, status: 'Restricted', reason }); setDialog(null) }} />}
    {dialog === 'suspend' && <ConfirmDialog title={`Suspend ${partner.name}?`} detail="Suspension blocks new assignments and offers. Existing delivery assignment and history will remain in place for an operations review." confirmLabel="Suspend partner" danger onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restrict', partnerId: partner.id, status: 'Suspended', reason }); setDialog(null) }} />}
    {dialog === 'restore' && <ConfirmDialog title={`Restore ${partner.name}?`} detail="Restoring removes the restriction/suspension. Document checks and any existing assignment still affect eligibility." reasonLabel="Restoration reason" confirmLabel="Restore partner" onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.restore', partnerId: partner.id, reason }); setDialog(null) }} />}
    {dialog === 'availability' && <ConfirmDialog title={partner.availability === 'Offline' ? 'Set partner available?' : 'Take partner offline?'} detail="Availability changes are saved to the partner history. An active delivery cannot be marked available." reasonLabel="Operational note" confirmLabel={partner.availability === 'Offline' ? 'Set available' : 'Take offline'} onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'partner.availability', partnerId: partner.id, availability: partner.availability === 'Offline' ? 'Available' : 'Offline', reason }); setDialog(null) }} />}
    {document && <DocumentDialog key={document.id} document={document} onClose={() => setDocumentId(null)} />}
  </div>
}

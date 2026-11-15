import { useMemo, useState, type FormEvent } from 'react'
import type { OperationsState, PartnerApplication } from '../domain/model'
import { Button, Dialog, EmptyState, formatDate, Icon, initials, Panel, StatusBadge } from '../components/ui'
import { useOperations } from '../state/OperationsProvider'

export function ApplicationReviewDialog({ application, initialDecision, onClose }: { application: PartnerApplication; initialDecision: 'Approved' | 'Rejected'; onClose: () => void }) {
  const { frame, dispatch } = useOperations()
  const [decision, setDecision] = useState<'Approved' | 'Rejected'>(initialDecision)
  const [note, setNote] = useState('')
  const isRejected = decision === 'Rejected'
  const isAdmin = frame.data.user.role === 'Admin'
  const requiredDocuments = frame.data.settings.requiredDocuments

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isAdmin) return
    if (decision === 'Approved') dispatch({ type: 'application.approve', applicationId: application.id, note })
    else dispatch({ type: 'application.reject', applicationId: application.id, reason: note })
    onClose()
  }

  return <Dialog title={`Review ${application.id}`} eyebrow="KYC APPLICATION REVIEW" onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>
      <p className="dialog-description">Onboarding KYC application from <strong>{application.applicantName}</strong> · {application.businessName}. Illustrative record only — no real identity checks or document files are connected.</p>
      <div className="application-review-summary">
        <div><span>Applicant</span><strong>{application.applicantName}</strong></div>
        <div><span>Business</span><strong>{application.businessName}</strong></div>
        <div><span>Vehicle</span><strong>{application.vehicle}</strong></div>
        <div><span>Service areas</span><strong>{application.serviceAreas.join(', ')}</strong></div>
        <div><span>Submitted</span><strong>{formatDate(application.submittedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
        <div><span>Documents</span><strong>{application.documents.length} attached</strong></div>
      </div>
      <div className="application-doc-checklist"><span className="application-doc-checklist-label">KYC documents submitted</span>{requiredDocuments.map((type) => {
        const attached = application.documents.includes(type)
        return <div key={type} className={attached ? 'attached' : 'missing'}><span><Icon name={attached ? 'check-circle' : 'alert'} size={13} />{type}</span><small>{attached ? 'Attached' : 'Not submitted'}</small></div>
      })}</div>
      <label className="field-label">Decision<select value={decision} onChange={(event) => setDecision(event.target.value as 'Approved' | 'Rejected')} disabled={!isAdmin}><option value="Approved">Approve application</option><option value="Rejected">Reject application</option></select></label>
      <label className="field-label">{isRejected ? 'Rejection reason (required)' : 'Approval note (optional)'}<textarea rows={3} maxLength={240} required={isRejected} value={note} disabled={!isAdmin} onChange={(event) => setNote(event.target.value)} placeholder={isRejected ? 'Explain why this application cannot be approved' : 'Optional note for the audit record'} /></label>
      {!isRejected && <p className="dialog-description">Approving adds the applicant to the partner directory and queues their submitted documents for KYC review.</p>}
      <div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant={isRejected ? 'danger' : 'primary'} disabled={!isAdmin} title={isAdmin ? undefined : 'Administrator access required'}>{isRejected ? 'Reject application' : 'Approve application'}</Button></div>
    </form>
  </Dialog>
}

export function ApplicationsPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame } = useOperations()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Needs review')
  const [vehicle, setVehicle] = useState('All')
  const [page, setPage] = useState(1)
  const [review, setReview] = useState<{ applicationId: string; decision: 'Approved' | 'Rejected' } | null>(null)
  const pageSize = 10
  const canReview = frame.data.user.role === 'Admin'

  const filtered = useMemo(() => data.applications.filter((application) => {
    const query = search.trim().toLowerCase()
    const matchesQuery = !query || [application.id, application.applicantName, application.businessName, application.vehicle, ...application.serviceAreas].join(' ').toLowerCase().includes(query)
    return matchesQuery
      && (status === 'All' || (status === 'Needs review' ? application.status === 'Submitted' : application.status === status))
      && (vehicle === 'All' || application.vehicle === vehicle)
  }).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [data.applications, search, status, vehicle])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const application = review ? data.applications.find((item) => item.id === review.applicationId) : undefined

  return <>
    <Panel className="records-panel kyc-queue-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>onboarding applications</span><span className="dot-separator" />Administrator approval only</div><span className="demo-caption">Approve to onboard · reject with a recorded reason</span></div>
      <div className="filter-toolbar kyc-filter-toolbar"><label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search applicant, business, ID, or area" aria-label="Search onboarding applications" /></label><label className="filter-control"><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option>Needs review</option><option>All</option><option>Approved</option><option>Rejected</option></select></label><label className="filter-control"><span>Vehicle</span><select value={vehicle} onChange={(event) => { setVehicle(event.target.value); setPage(1) }}><option>All</option><option>Bike</option><option>Scooter</option><option>Van</option></select></label></div>
      <div className="table-scroll"><table className="data-table applications-table"><thead><tr><th>Applicant</th><th>Vehicle / areas</th><th>Documents</th><th>Submitted</th><th>Status</th><th>Decision / reviewer</th><th>Actions</th></tr></thead><tbody>
        {visible.map((item) => {
          const missing = data.settings.requiredDocuments.filter((type) => !item.documents.includes(type))
          return <tr key={item.id}>
            <td><span className="partner-cell"><span className="mini-avatar">{initials(item.applicantName)}</span><span><b>{item.applicantName}</b><small>{item.id} · {item.businessName}</small></span></span></td>
            <td><span className="application-documents"><strong><Icon name={item.vehicle === 'Bike' ? 'bike' : item.vehicle === 'Van' ? 'van' : 'scooter'} size={15} /> {item.vehicle}</strong><small>{item.serviceAreas.join(', ')}</small></span></td>
            <td><span className="application-documents"><strong>{item.documents.length} submitted</strong><small>{missing.length ? `Missing: ${missing.join(', ')}` : 'All mandatory documents attached'}</small></span></td>
            <td>{formatDate(item.submittedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td><StatusBadge status={item.status} /></td>
            <td><span className={item.status === 'Rejected' ? 'kyc-issue-text' : 'kyc-reviewer-text'}>{item.decisionReason ?? item.reviewedBy ?? 'Awaiting Administrator review'}</span>{item.reviewedAt && <small className="muted-text">{formatDate(item.reviewedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</small>}{item.partnerAppUid && <small className="muted-text">delivery_app account linked</small>}</td>
            <td>{item.status === 'Submitted'
              ? <span className="row-action-group"><Button size="small" variant="primary" disabled={!canReview} title={canReview ? 'Approve this KYC application' : 'Administrator access required'} onClick={() => setReview({ applicationId: item.id, decision: 'Approved' })}>Approve</Button><Button size="small" variant="danger" disabled={!canReview} title={canReview ? 'Reject this KYC application' : 'Administrator access required'} onClick={() => setReview({ applicationId: item.id, decision: 'Rejected' })}>Reject</Button></span>
              : <Button size="small" variant="quiet" onClick={() => item.partnerId ? open(`/admin/partners/${item.partnerId}`) : undefined} disabled={!item.partnerId}>{item.partnerId ? 'Open partner' : 'Decision recorded'}</Button>}</td>
          </tr>
        })}
      </tbody></table>{visible.length === 0 && <EmptyState title="No applications match" detail="Adjust the status or vehicle filters. Pending applications are shown by default." />}</div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
      <div className="notification-history-note"><Icon name="shield" size={14} />Only an Administrator can approve or reject an onboarding application. Rejections require a reason, and every decision is written to the audit log.</div>
    </Panel>
    {application && <ApplicationReviewDialog key={`${application.id}-${review?.decision ?? 'Approved'}`} application={application} initialDecision={review?.decision ?? 'Approved'} onClose={() => setReview(null)} />}
  </>
}

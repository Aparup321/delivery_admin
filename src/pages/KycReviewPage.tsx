import { useMemo, useState, type FormEvent } from 'react'
import { userCan } from '../domain/admin'
import type { OperationsState, Partner, PartnerAppDocument, PartnerAppDocumentFile, PartnerAppRecord, PartnerApplication, PartnerDocumentReview } from '../domain/model'
import {
  buildKycQueue,
  documentLabel,
  formatDocumentNumber,
  liveDocumentsBlocked,
  partnerDocumentNumber,
  requiredLiveDocumentKeys,
  submittedLiveDocumentKeys,
  type KycQueueItem,
} from '../domain/kyc'
import { Button, Dialog, EmptyState, formatDate, Icon, initials, Panel, StatusBadge } from '../components/ui'
import { beginFirebaseDataConnection } from '../auth/adminSession'
import { liveServiceAreas } from '../domain/operations'
import { readPartnerAppToken, syncPartnerAppDocuments, syncPartnerAppRecords, writePartnerDocumentReview } from '../services/partnerApp'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
import { clearQuotaBlock, describeSyncError } from '../services/firestoreQuota'
import { useOperations } from '../state/OperationsProvider'

type StatusFilter = 'Needs review' | 'KYC pending' | 'All' | 'Approved' | 'Rejected'

function vehicleIcon(vehicle: string): 'bike' | 'scooter' | 'van' | 'route' {
  const normalized = vehicle.toLowerCase()
  if (normalized.includes('van')) return 'van'
  if (normalized.includes('scooter')) return 'scooter'
  if (normalized.includes('bicycle') || normalized.includes('bike') || normalized.includes('foot') || normalized.includes('walk')) return 'bike'
  return 'route'
}

/**
 * Human-readable partner details for the review dialogs. Identity numbers are
 * kept as text so an administrator can read and copy them without opening a
 * document file.
 */
function partnerTextDetails(record: PartnerAppRecord | undefined, documents: PartnerAppDocument | undefined): Array<[string, string]> {
  if (!record) return []
  const field = (...keys: string[]) => {
    for (const key of keys) {
      const value = record.fields[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  }
  const number = (key: string) => {
    const file = documents?.files.find((item) => item.key === key)
      ?? { key, fileName: null, documentNumber: null, downloadUrl: null, uploadedAt: null, review: null }
    return partnerDocumentNumber(file, record)
  }
  const dateOfBirth = field('dateOfBirth')
  const aadhaar = number('aadhaar')
  const pan = number('pan')
  const licence = number('licence')
  const registration = number('registration')
  const rows: Array<[string, string | null]> = [
    ['Address', [field('addressLine', 'address', 'fullAddress'), field('city'), field('pincode', 'postalCode')].filter(Boolean).join(', ') || null],
    ['Date of birth', dateOfBirth ? formatDate(dateOfBirth, { month: 'short', day: 'numeric', year: 'numeric' }) : null],
    ['Aadhaar number', aadhaar ? formatDocumentNumber('aadhaar', aadhaar) : null],
    ['PAN number', pan ? formatDocumentNumber('pan', pan) : null],
    ['Driving licence number', licence ? formatDocumentNumber('licence', licence) : null],
    ['Vehicle registration number', registration ? formatDocumentNumber('registration', registration) : null],
    ['Bank passbook number', number('passbook')],
    ['Vehicle model', field('vehicleModel', 'vehicle.model', 'model')],
    ['Vehicle colour', field('vehicleColour', 'vehicle.color', 'colour', 'color')],
    ['Bank account holder', field('bank.accountHolder', 'accountHolder')],
    ['Bank account number', field('bank.accountNumber', 'accountNumber')],
    ['IFSC code', field('bank.ifsc', 'ifsc')],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

const structuredDetailKeys = new Set([
  'dateOfBirth', 'addressLine', 'address', 'fullAddress', 'city', 'pincode', 'postalCode',
  'vehicleModel', 'vehicle.model', 'model', 'vehicleColour', 'vehicle.color', 'colour', 'color',
  'vehicleRegistrationNumber', 'vehicle.registrationNumber', 'registrationNumber',
  'vehicleLicenceNumber', 'vehicle.licenceNumber', 'licenceNumber', 'licenseNumber',
  'bank.accountHolder', 'accountHolder', 'bank.accountNumber', 'accountNumber', 'bank.ifsc', 'ifsc',
])

export function ApplicationReviewDialog({ application, initialDecision, documentsBlockedReason, onClose }: { application: PartnerApplication; initialDecision: 'Approved' | 'Rejected'; documentsBlockedReason?: string | null; onClose: () => void }) {
  const { frame, dispatch } = useOperations()
  const [decision, setDecision] = useState<'Approved' | 'Rejected'>(initialDecision)
  const [note, setNote] = useState('')
  const isRejected = decision === 'Rejected'
  const isAdmin = userCan(frame.data.user, 'application-review')
  const requiredDocuments = frame.data.settings.requiredDocuments

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isAdmin) return
    if (decision === 'Approved' && documentsBlockedReason && application.partnerAppUid) return
    if (decision === 'Approved') dispatch({ type: 'application.approve', applicationId: application.id, note })
    else dispatch({ type: 'application.reject', applicationId: application.id, reason: note })
    onClose()
  }

  return <Dialog title={`Review ${application.id}`} eyebrow="KYC APPLICATION REVIEW" onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>
      <p className="dialog-description">Onboarding KYC application from <strong>{application.applicantName}</strong> · {application.businessName}. Record the Administrator decision below; every decision is written to the audit log.</p>
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
      {!isRejected && <p className="dialog-description">Approving adds the applicant to the partner directory. Required documents must be reviewed and valid for a delivery_app application.</p>}
      {!isRejected && documentsBlockedReason && application.partnerAppUid && <div className="soft-notice error-notice"><Icon name="alert" size={15} /><span>{documentsBlockedReason} Review the documents from Details before approving.</span></div>}
      <div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant={isRejected ? 'danger' : 'primary'} disabled={!isAdmin || (!isRejected && Boolean(documentsBlockedReason) && Boolean(application.partnerAppUid))} title={isAdmin ? undefined : 'Main administrator access required'}>{isRejected ? 'Reject application' : 'Approve application'}</Button></div>
    </form>
  </Dialog>
}

export function LiveApplicationReviewDialog({ record, application, linkedPartner, documents, initialDecision = 'Approved', documentsBlockedReason, onClose }: { record: PartnerAppRecord; application: PartnerApplication | undefined; linkedPartner: Partner | undefined; documents?: PartnerAppDocument; initialDecision?: 'Approved' | 'Rejected'; documentsBlockedReason?: string | null; onClose: () => void }) {
  const { frame, dispatch } = useOperations()
  const [decision, setDecision] = useState<'Approved' | 'Rejected'>(initialDecision)
  const [note, setNote] = useState('')
  const isRejected = decision === 'Rejected'
  const isAdmin = userCan(frame.data.user, 'application-review')
  const partnerDetails = partnerTextDetails(record, documents)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isAdmin) return
    if (decision === 'Approved' && documentsBlockedReason) return
    dispatch({ type: 'partnerApp.review', recordId: record.id, decision, note })
    onClose()
  }

  return <Dialog title={`Review ${record.name}`} eyebrow="DELIVERY_APP APPLICATION" onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>
      <p className="dialog-description">This onboarding application was submitted from delivery_app.{' '}
        {linkedPartner
          ? `The decision is recorded against ${linkedPartner.id} and written to partners/${record.id}.`
          : 'Approving creates a matching admin partner record and links it to this delivery_app account.'}
        {application?.status === 'Rejected' ? ' It was rejected before and has been resubmitted.' : ''}
      </p>
      <div className="application-review-summary">
        <div><span>Applicant</span><strong>{record.name}</strong></div>
        <div><span>Contact</span><strong>{record.phone ?? '—'}</strong></div>
        <div><span>Email</span><strong>{record.email ?? '—'}</strong></div>
        <div><span>Vehicle</span><strong>{record.vehicle ?? '—'}</strong></div>
        <div><span>Service areas</span><strong>{liveServiceAreas(record).join(', ') || '—'}</strong></div>
        <div><span>Submitted</span><strong>{formatDate(record.updatedAt ?? record.syncedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
        <div><span>delivery_app UID</span><strong>{record.id}</strong></div>
      </div>
      {partnerDetails.length > 0 && <div className="application-review-summary">
        {partnerDetails.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>}
      <label className="field-label">Decision<select value={decision} onChange={(event) => setDecision(event.target.value as 'Approved' | 'Rejected')} disabled={!isAdmin}><option value="Approved">Approve application</option><option value="Rejected">Reject application</option></select></label>
      <label className="field-label">{isRejected ? 'Rejection reason (required)' : 'Approval note (optional)'}<textarea rows={3} maxLength={240} required={isRejected} value={note} disabled={!isAdmin} onChange={(event) => setNote(event.target.value)} placeholder={isRejected ? 'Explain why this application cannot be approved' : 'Optional note for the audit record'} /></label>
      <p className="dialog-description">{isRejected ? 'The reason appears in delivery_app on the partner’s application status screen.' : 'Approval activates the delivery_app account so the partner can go online.'}</p>
      {!isRejected && documentsBlockedReason && <div className="soft-notice error-notice"><Icon name="alert" size={15} /><span>{documentsBlockedReason} Review the documents from Details before approving.</span></div>}
      <div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant={isRejected ? 'danger' : 'primary'} disabled={!isAdmin || (!isRejected && Boolean(documentsBlockedReason))} title={isAdmin ? undefined : 'Main administrator access required'}>{isRejected ? 'Reject application' : 'Approve application'}</Button></div>
    </form>
  </Dialog>
}

const detailFieldLabels: Record<string, string> = {
  dateOfBirth: 'Date of birth',
  addressLine: 'Address',
  city: 'City',
  pincode: 'PIN code',
  joinedOn: 'Joined on',
  rating: 'Rating',
  'bank.accountHolder': 'Bank account holder',
  'bank.accountNumber': 'Bank account number',
  'bank.ifsc': 'IFSC code',
  'adminSuspension.active': 'Account suspended',
  'adminSuspension.reason': 'Suspension reason',
  'adminSuspension.updatedBy': 'Suspended by',
  'adminSuspension.updatedAt': 'Suspended at',
  'adminReview.reviewedBy': 'Reviewed by',
  'adminReview.reason': 'Decision reason',
  'adminReview.reviewedAt': 'Reviewed at',
  statusUpdatedAt: 'Status updated at',
  adminPartnerId: 'Admin partner ID',
}

const detailSummaryKeys = new Set([
  'partnerId',
  'fullName',
  'phone',
  'email',
  'vehicleType',
  'applicationStatus',
  'status',
  'submittedAt',
  'updatedAt',
  'adminReview.decision',
  'adminReview.applicationId',
  'adminReview.adminPartnerId',
])

const detailHiddenKeys = new Set([
  'profilePhotoUrl',
  'profilePhotoPath',
  'lastLocation',
  'lastLocationUpdatedAt',
  'isOnline',
  'lastSeen',
  'fcmToken',
  'deviceToken',
])

function detailFieldLabel(key: string) {
  if (detailFieldLabels[key]) return detailFieldLabels[key]
  return key
    .replace(/[._]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const detailDateKeys = new Set(['adminReview.reviewedAt', 'adminSuspension.updatedAt', 'statusUpdatedAt'])

function detailFieldValue(key: string, value: string) {
  if (!detailDateKeys.has(key)) return value
  return formatDate(value, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function sentenceCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

export function KycApplicationDetailsDialog({ item, application, record, documentRecord, onClose, onReview, onOpenPartner }: { item: KycQueueItem; application?: PartnerApplication; record?: PartnerAppRecord; documentRecord?: PartnerAppDocument; onClose: () => void; onReview?: () => void; onOpenPartner?: () => void }) {
  const { frame, dispatch } = useOperations()
  const documents = application?.documents ?? item.documents
  const attachedCount = documentRecord
    ? documentRecord.files.filter((file) => Boolean(file.fileName || partnerDocumentNumber(file, record))).length
    : documents.length
  const phone = record?.phone ?? application?.maskedPhone ?? null
  const email = record?.email ?? application?.maskedEmail ?? null
  const canReviewDocuments = userCan(frame.data.user, 'document-review') && hasFirebaseAdminSession()
  const [reviewing, setReviewing] = useState<{ key: string; status: 'Verified' | 'Rejected'; expiresAt: string; note: string } | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const partnerDetails = partnerTextDetails(record, documentRecord)
  const detailFields = record
    ? Object.entries(record.fields)
        .filter(([key, value]) => value.trim() && !detailSummaryKeys.has(key) && !detailHiddenKeys.has(key) && !structuredDetailKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
    : []

  function beginReview(file: PartnerAppDocumentFile) {
    setReviewError('')
    setReviewing({
      key: file.key,
      status: file.review?.status ?? 'Verified',
      expiresAt: file.review?.expiresAt ? file.review.expiresAt.slice(0, 10) : '',
      note: file.review?.note ?? '',
    })
  }

  async function saveReview() {
    if (!reviewing || !documentRecord) return
    setReviewBusy(true)
    setReviewError('')
    try {
      const review: PartnerDocumentReview = {
        status: reviewing.status,
        expiresAt: reviewing.expiresAt ? new Date(`${reviewing.expiresAt}T23:59:59`).toISOString() : null,
        note: reviewing.note.trim() || null,
        reviewedBy: frame.data.user.name,
        reviewedAt: new Date().toISOString(),
      }
      await writePartnerDocumentReview(frame.data.partnerApp, readPartnerAppToken(), documentRecord.id, reviewing.key, review)
      dispatch({ type: 'partnerApp.document-review', uid: documentRecord.id, documentKey: reviewing.key, review, at: new Date().toISOString() })
      setReviewing(null)
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not save the document review.')
    } finally {
      setReviewBusy(false)
    }
  }

  return <Dialog title="Application details" eyebrow="KYC APPLICATION DETAILS" onClose={onClose} wide>
    <div className="dialog-form kyc-details-dialog">
      <div className="details-dialog-header">
        <span className="details-avatar">{initials(item.applicantName)}</span>
        <div className="details-identity"><strong>{item.applicantName}</strong><span>{item.businessName}</span></div>
        <div className="details-header-status"><StatusBadge status={item.status} /><small>{item.source === 'delivery_app' ? 'delivery_app application' : 'Admin application'}</small></div>
      </div>
      <div className="application-review-summary details-summary">
        <div><span>Application ID</span><strong>{item.applicationId ?? record?.id ?? '—'}</strong></div>
        <div><span>Phone</span><strong>{phone || '—'}</strong></div>
        <div><span>Email</span><strong>{email || '—'}</strong></div>
        <div><span>Vehicle</span><strong>{sentenceCase(item.vehicle) || '—'}</strong></div>
        <div><span>Service areas</span><strong>{item.serviceAreas.join(', ') || '—'}</strong></div>
        <div><span>Submitted</span><strong>{formatDate(item.submittedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
        {item.reviewedAt && <div><span>Reviewed</span><strong>{formatDate(item.reviewedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>}
        {record && item.applicationId && <div><span>delivery_app UID</span><strong>{record.id}</strong></div>}
        {item.partnerId && <div><span>Admin partner</span><strong>{item.partnerId}</strong></div>}
        {item.reviewedBy && <div><span>Reviewed by</span><strong>{item.reviewedBy}</strong></div>}
        {item.decisionReason && <div><span>Decision note</span><strong>{item.decisionReason}</strong></div>}
      </div>
      {partnerDetails.length > 0 && <section className="details-section">
        <div className="details-section-head">
          <span className="details-section-icon"><Icon name="user" size={14} /></span>
          <div><strong>Partner details</strong><small>Submitted during onboarding</small></div>
          <span className="details-section-count">{partnerDetails.length} fields</span>
        </div>
        <div className="details-field-grid">
          {partnerDetails.map(([label, value]) => <div key={label} className="details-tile"><span>{label}</span><strong>{value}</strong></div>)}
        </div>
      </section>}
      <section className="details-section">
        <div className="details-section-head">
          <span className="details-section-icon"><Icon name="file" size={14} /></span>
          <div><strong>Submitted documents</strong><small>KYC checklist</small></div>
          <span className="details-section-count">{attachedCount > 0 ? `${attachedCount} attached` : 'Not available'}</span>
        </div>
        <div className="application-doc-checklist details-document-list">
          {documentRecord && documentRecord.files.length > 0
            ? documentRecord.files.map((file) => {
                const number = partnerDocumentNumber(file, record)
                const provided = Boolean(file.fileName || number)
                return <div key={file.key} className="live-document-row">
                  <span className="live-document-main">
                    <Icon name="file" size={13} />
                    <span>
                      <strong>{documentLabel(file.key)}</strong>
                      <small>{file.fileName ?? (provided ? 'Number on record · no file uploaded' : 'Not submitted')}{file.uploadedAt ? ` · ${formatDate(file.uploadedAt, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</small>
                      {number && <small className="document-number">Number: {formatDocumentNumber(file.key, number)}</small>}
                    </span>
                  </span>
                  <span className="live-document-meta">
                    {!provided ? <StatusBadge status="Missing" /> : file.review ? <StatusBadge status={file.review.status} /> : <StatusBadge status="Under Review" />}
                    {file.review?.expiresAt && <small className={new Date(file.review.expiresAt).getTime() <= Date.now() ? 'text-danger' : ''}>Expires {formatDate(file.review.expiresAt, { month: 'short', day: 'numeric', year: 'numeric' })}</small>}
                    {file.downloadUrl && <a href={file.downloadUrl} target="_blank" rel="noreferrer">Open file</a>}
                    {canReviewDocuments && provided && <Button size="small" variant="quiet" onClick={() => beginReview(file)}>Review</Button>}
                  </span>
                </div>
              })
            : documents.length > 0
              ? documents.map((document) => <div key={document} className="attached"><span><Icon name="check-circle" size={13} />{document}</span><small>Attached</small></div>)
              : <div className="details-empty"><span>No document details available</span><small>{item.status === 'KYC pending' ? 'Onboarding has not been submitted' : 'No partner_documents record was synced for this account yet.'}</small></div>}
        </div>
        {reviewing && <div className="document-review-inline">
          <div className="document-review-inline-head"><strong>Review {documentLabel(reviewing.key)}</strong><span>Saved to delivery_app</span></div>
          <div className="form-grid two-columns">
            <label className="field-label">Status<select value={reviewing.status} onChange={(event) => setReviewing({ ...reviewing, status: event.target.value as 'Verified' | 'Rejected' })}><option>Verified</option><option>Rejected</option></select></label>
            <label className="field-label">Expiry date<input type="date" value={reviewing.expiresAt} onChange={(event) => setReviewing({ ...reviewing, expiresAt: event.target.value })} /></label>
            <label className="field-label span-two">Reviewer note<textarea rows={2} value={reviewing.note} onChange={(event) => setReviewing({ ...reviewing, note: event.target.value })} placeholder="Optional verification note" /></label>
          </div>
          {reviewError && <div className="admin-form-error" role="alert"><Icon name="alert" size={15} /><span>{reviewError}</span></div>}
          <div className="dialog-actions"><Button onClick={() => setReviewing(null)}>Cancel</Button><Button variant="primary" disabled={reviewBusy} onClick={() => { void saveReview() }}>{reviewBusy ? 'Saving…' : 'Save review'}</Button></div>
        </div>}
      </section>
      {detailFields.length > 0 && <section className="details-section">
        <div className="details-section-head">
          <span className="details-section-icon"><Icon name="info" size={14} /></span>
          <div><strong>Additional submitted information</strong><small>Synced from delivery_app</small></div>
          <span className="details-section-count">{detailFields.length} fields</span>
        </div>
        <div className="details-field-grid">
          {detailFields.map(([key, value]) => <div key={key} className="details-tile"><span>{detailFieldLabel(key)}</span><strong>{detailFieldValue(key, value)}</strong></div>)}
        </div>
      </section>}
      <div className="dialog-actions"><Button onClick={onClose}>Close</Button>{onOpenPartner && <Button onClick={onOpenPartner}><Icon name="external" size={13} />Open partner</Button>}{onReview && <Button variant="primary" onClick={onReview}><Icon name="shield" size={13} />Review decision</Button>}</div>
    </div>
  </Dialog>
}

export function KycReviewPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame, dispatch } = useOperations()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('Needs review')
  const [vehicle, setVehicle] = useState('All')
  const [page, setPage] = useState(1)
  const [review, setReview] = useState<{ key: string; decision: 'Approved' | 'Rejected' } | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const pageSize = 10
  const canReview = userCan(frame.data.user, 'application-review')
  const config = data.partnerApp
  const configured = config.mode === 'firestore' ? Boolean(config.projectId.trim() && config.partnersCollection.trim()) : Boolean(config.endpointUrl.trim())
  const firebaseSignedIn = hasFirebaseAdminSession()

  async function refreshLive() {
    if (!firebaseSignedIn) {
      beginFirebaseDataConnection()
      return
    }
    if (!configured) {
      open('/admin/settings?tab=partner-app')
      return
    }
    setRefreshing(true)
    try {
      const token = readPartnerAppToken()
      const [records, documents] = await Promise.all([
        syncPartnerAppRecords(config, token),
        syncPartnerAppDocuments(config, token).catch(() => []),
      ])
      clearQuotaBlock(config.projectId)
      dispatch({ type: 'partnerApp.sync-result', records, documents, at: new Date().toISOString(), silent: true })
    } catch (error) {
      dispatch({ type: 'partnerApp.failed', message: describeSyncError(error, 'KYC refresh failed.', config.projectId) })
    } finally {
      setRefreshing(false)
    }
  }
  const queue = useMemo(() => buildKycQueue(data), [data])
  const pending = queue.filter((item) => item.status === 'Submitted').length
  const onboardingPending = queue.filter((item) => item.status === 'KYC pending').length
  const liveCount = queue.filter((item) => item.source === 'delivery_app').length
  const vehicles = [...new Set(queue.map((item) => item.vehicle).filter((value) => value && value !== '—'))].sort()

  const filtered = useMemo(() => queue.filter((item) => {
    const query = search.trim().toLowerCase()
    const matchesQuery = !query || [
      item.applicantName,
      item.businessName,
      item.applicationId ?? '',
      item.recordId ?? '',
      item.contact,
      item.vehicle,
      ...item.serviceAreas,
    ].join(' ').toLowerCase().includes(query)
    const matchesStatus = status === 'All'
      || (status === 'Needs review'
        ? item.status === 'Submitted' || item.status === 'KYC pending'
        : item.status === status)
    return matchesQuery
      && matchesStatus
      && (vehicle === 'All' || item.vehicle === vehicle)
  }), [queue, search, status, vehicle])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  const reviewItem = review ? queue.find((item) => item.key === review.key) : undefined
  const reviewApplication = reviewItem?.applicationId ? data.applications.find((item) => item.id === reviewItem.applicationId) : undefined
  const reviewRecord = reviewItem?.recordId ? data.partnerAppRecords.find((item) => item.id === reviewItem.recordId) : undefined
  const reviewLive = Boolean(reviewItem?.source === 'delivery_app' || reviewItem?.resubmitted)
  const reviewLinkedPartner = reviewRecord ? data.partners.find((item) => item.partnerAppUid === reviewRecord.id) : undefined
  const reviewDocuments = reviewRecord ? data.partnerAppDocuments.find((document) => document.id === reviewRecord.id) : undefined
  const reviewBlockedReason = reviewRecord ? liveDocumentsBlocked(reviewRecord, reviewDocuments) : null
  const detailsItem = details ? queue.find((item) => item.key === details) : undefined
  const detailsApplication = detailsItem?.applicationId ? data.applications.find((item) => item.id === detailsItem.applicationId) : undefined
  const detailsRecord = detailsItem?.recordId ? data.partnerAppRecords.find((item) => item.id === detailsItem.recordId) : undefined
  const detailsDocuments = detailsRecord ? data.partnerAppDocuments.find((document) => document.id === detailsRecord.id) : undefined

  return <>
    <Panel className="records-panel kyc-queue-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>KYC applications</span><span className="dot-separator" />{pending} awaiting review · {onboardingPending} KYC pending · {liveCount} from delivery_app</div><div className="row-action-group"><span className="demo-caption">Main administrator approval only</span>{firebaseSignedIn
        ? <Button size="small" onClick={refreshLive} disabled={refreshing || !configured}><Icon name="refresh" size={14} />{refreshing ? 'Refreshing…' : 'Refresh live data'}</Button>
        : <Button size="small" variant="primary" onClick={beginFirebaseDataConnection} disabled={!configured}><Icon name="lock" size={14} />Sign in to load live applications</Button>}</div></div>
      {data.partnerApp.lastError && <div className="soft-notice"><Icon name="alert" size={15} /><span>{data.partnerApp.lastError}</span><Button size="small" variant="primary" onClick={refreshLive} disabled={refreshing || !configured}>Retry</Button></div>}
      <div className="filter-toolbar kyc-filter-toolbar">
        <label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search applicant, business, ID, contact, or area" aria-label="Search KYC applications" /></label>
        <label className="filter-control"><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1) }}><option>Needs review</option><option>KYC pending</option><option>All</option><option>Approved</option><option>Rejected</option></select></label>
        <label className="filter-control"><span>Vehicle</span><select value={vehicle} onChange={(event) => { setVehicle(event.target.value); setPage(1) }}><option>All</option>{vehicles.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="table-scroll"><table className="data-table applications-table"><thead><tr><th>Applicant</th><th>Vehicle / areas</th><th>Documents</th><th>Submitted / signed in</th><th>Status</th><th>Decision / reviewer</th><th>Actions</th></tr></thead><tbody>
        {visible.map((item) => {
          const missing = item.documentsKnown ? data.settings.requiredDocuments.filter((type) => !item.documents.includes(type)) : []
          const liveRecord = item.recordId ? data.partnerAppRecords.find((record) => record.id === item.recordId) : undefined
          const liveDocuments = item.recordId ? data.partnerAppDocuments.find((document) => document.id === item.recordId) : undefined
          const liveSubmitted = submittedLiveDocumentKeys(liveDocuments, liveRecord)
          const liveMissing = liveDocuments
            ? requiredLiveDocumentKeys(item.vehicle).filter((key) => !liveSubmitted.includes(key))
            : []
          return <tr key={item.key}>
            <td><span className="partner-cell"><span className="mini-avatar">{initials(item.applicantName)}</span><span><b>{item.applicantName}</b><small>{item.applicationId ? `${item.applicationId} · ${item.businessName}` : `${item.contact} · delivery_app`}</small></span></span></td>
            <td><span className="application-documents"><strong><Icon name={vehicleIcon(item.vehicle)} size={15} /> {item.vehicle}</strong><small>{item.serviceAreas.join(', ') || 'No service areas'}</small></span></td>
            <td>{liveDocuments
              ? liveSubmitted.length > 0
                ? <span className="application-documents"><strong>{liveSubmitted.length} submitted</strong><small>{liveSubmitted.map(documentLabel).join(', ')}</small>{liveMissing.length > 0 && <small className="kyc-issue-text">Missing: {liveMissing.map(documentLabel).join(', ')}</small>}</span>
                : <span className="application-documents"><strong>No documents</strong><small>None submitted in delivery_app</small></span>
              : item.documentsKnown
                ? <span className="application-documents"><strong>{item.documents.length} submitted</strong><small>{missing.length ? `Missing: ${missing.join(', ')}` : 'All mandatory documents attached'}</small></span>
                : item.status === 'KYC pending'
                  ? <span className="application-documents"><strong>Not submitted</strong><small>Onboarding required</small></span>
                  : item.source === 'delivery_app'
                    ? <span className="application-documents"><strong>Documents</strong><small>Not synced yet</small></span>
                    : <span className="application-documents"><strong>delivery_app</strong><small>No local document record</small></span>}</td>
            <td>{formatDate(item.submittedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td><StatusBadge status={item.status} /></td>
            <td><span className={item.status === 'Rejected' ? 'kyc-issue-text' : 'kyc-reviewer-text'}>{item.status === 'KYC pending' ? 'Onboarding not submitted' : item.decisionReason ?? item.reviewedBy ?? (item.status === 'Submitted' ? 'Awaiting Administrator review' : 'Decision recorded')}</span>{item.reviewedAt && <small className="muted-text">{formatDate(item.reviewedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</small>}{item.resubmitted && <small className="kyc-issue-text">Resubmitted from delivery_app</small>}{!item.resubmitted && item.source === 'admin' && item.partnerAppUid && <small className="muted-text">delivery_app account linked</small>}</td>
            <td><span className="row-action-group"><Button size="small" variant="quiet" onClick={() => setDetails(item.key)}><Icon name="eye" size={13} />Details</Button>{item.status === 'Submitted'
              ? <><Button size="small" variant="primary" disabled={!canReview} title={canReview ? 'Approve this KYC application' : 'Main administrator access required'} onClick={() => setReview({ key: item.key, decision: 'Approved' })}>Approve</Button><Button size="small" variant="danger" disabled={!canReview} title={canReview ? 'Reject this KYC application' : 'Main administrator access required'} onClick={() => setReview({ key: item.key, decision: 'Rejected' })}>Reject</Button></>
              : item.status === 'KYC pending'
                ? <Button size="small" variant="quiet" disabled title="The partner must submit onboarding before KYC review">Awaiting onboarding</Button>
                : <Button size="small" variant="quiet" onClick={() => item.partnerId ? open(`/admin/partners/${item.partnerId}`) : undefined} disabled={!item.partnerId}>{item.partnerId ? 'Open partner' : 'Decision recorded'}</Button>}</span></td>
          </tr>
        })}
      </tbody></table>{visible.length === 0 && <EmptyState title="No KYC applications match" detail="Adjust the status or vehicle filters. Submitted onboarding applications from Firebase are shown here." />}</div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
      <div className="notification-history-note"><Icon name="shield" size={14} />Only a main administrator can approve or reject a KYC application. Rejections require a reason, and every decision is written to the audit log. Sign-in-only partner accounts stay out of this queue until onboarding is submitted; delivery_app records sync automatically after Firebase sign-in and periodically refresh.</div>
    </Panel>
    {review && reviewLive && reviewRecord && <LiveApplicationReviewDialog key={`${reviewRecord.id}-${review.decision}`} record={reviewRecord} application={reviewApplication} linkedPartner={reviewLinkedPartner} documents={reviewDocuments} documentsBlockedReason={reviewBlockedReason} initialDecision={review.decision} onClose={() => setReview(null)} />}
    {review && !reviewLive && reviewApplication && <ApplicationReviewDialog key={`${reviewApplication.id}-${review.decision}`} application={reviewApplication} documentsBlockedReason={reviewBlockedReason} initialDecision={review.decision} onClose={() => setReview(null)} />}
    {detailsItem && <KycApplicationDetailsDialog item={detailsItem} application={detailsApplication} record={detailsRecord} documentRecord={detailsDocuments} onClose={() => setDetails(null)} onReview={detailsItem.status === 'Submitted' && canReview ? () => { setDetails(null); setReview({ key: detailsItem.key, decision: 'Approved' }) } : undefined} onOpenPartner={detailsItem.partnerId ? () => { setDetails(null); open(`/admin/partners/${detailsItem.partnerId}`) } : undefined} />}
  </>
}

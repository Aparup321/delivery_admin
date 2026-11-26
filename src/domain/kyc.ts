import { demoModeEnabled } from '../config/firebase.ts'
import { isDocumentCurrent, isLivePartnerApproved } from './operations.ts'
import type {
  DocumentStatus,
  DocumentType,
  OperationsState,
  Partner,
  PartnerAppDocument,
  PartnerAppDocumentFile,
  PartnerAppRecord,
  PartnerApplication,
  PartnerDocument,
} from './model.ts'

export type KycDecisionStatus = 'KYC pending' | 'Submitted' | 'Approved' | 'Rejected'
export type PartnerVerificationStatus = 'Verified' | 'Incomplete' | 'Under Review' | 'Attention Required'

export const kycDocumentLabels: Record<string, string> = {
  aadhaar: 'Aadhaar card',
  pan: 'PAN card',
  licence: 'Driving licence',
  dl: 'Driving licence',
  registration: 'Vehicle registration',
  rc: 'Vehicle registration',
  passbook: 'Bank passbook',
  voter: 'Voter ID',
  voterId: 'Voter ID',
}

export function documentLabel(key: string) {
  return kycDocumentLabels[key] ?? key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/** Aadhaar numbers read better in the 4-4-4 grouping printed on the card. */
export function formatDocumentNumber(key: string, value: string) {
  const trimmed = value.trim()
  if (key === 'aadhaar' && /^\d{12}$/.test(trimmed)) return trimmed.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')
  if (key === 'pan') return trimmed.toUpperCase()
  return trimmed
}

export function requiredLiveDocumentKeys(vehicle: string): string[] {
  const normalized = vehicle.toLowerCase()
  if (normalized.includes('bicycle') || normalized.includes('foot') || normalized.includes('walk')) return ['aadhaar']
  return ['aadhaar', 'licence', 'registration']
}

function liveVehicleNumber(record: PartnerAppRecord | undefined, key: 'registration' | 'licence') {
  if (!record) return null
  const aliases = key === 'registration'
    ? ['vehicleRegistrationNumber', 'vehicle.registrationNumber', 'registrationNumber']
    : ['vehicleLicenceNumber', 'vehicle.licenceNumber', 'licenceNumber', 'licenseNumber']
  for (const alias of aliases) {
    const value = record.fields[alias]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * Number for a document, falling back to the vehicle record. delivery_app
 * stores the RC and licence numbers on `vehicles`, not `partner_documents`.
 */
export function partnerDocumentNumber(file: PartnerAppDocumentFile | undefined, record?: PartnerAppRecord) {
  if (file?.documentNumber?.trim()) return file.documentNumber.trim()
  if (!file) return null
  if (file.key === 'registration') return liveVehicleNumber(record, 'registration')
  if (file.key === 'licence') return liveVehicleNumber(record, 'licence')
  return null
}

export function submittedLiveDocumentKeys(documents: PartnerAppDocument | undefined, record?: PartnerAppRecord) {
  if (!documents) return []
  return documents.files
    .filter((file) => Boolean(file.fileName || partnerDocumentNumber(file, record)))
    .map((file) => file.key)
}

/**
 * Blocks approval only when a mandatory document was never submitted, was
 * rejected, or expired. A typed document number counts as submitted even when
 * delivery_app had no file to upload. Individual document review remains
 * available in the Details dialog, but approving the application is itself the
 * KYC decision and must not be held back by an unreviewed number.
 */
export function liveDocumentsBlocked(record: PartnerAppRecord | undefined, documents: PartnerAppDocument | undefined) {
  if (!record) return 'No delivery_app application record was found.'
  if (!documents) return 'No partner_documents record has been synced. Sync partner data before approving.'
  for (const key of requiredLiveDocumentKeys(record.vehicle ?? '')) {
    const file = documents.files.find((item) => item.key === key)
    const number = partnerDocumentNumber(file, record)
    if (!file?.fileName && !number) return `${documentLabel(key)} has not been submitted.`
    if (file?.review?.status === 'Rejected') return `${documentLabel(key)} was rejected.`
    if (file?.review?.expiresAt && new Date(file.review.expiresAt).getTime() <= Date.now()) return `${documentLabel(key)} has expired.`
  }
  return null
}

export function displayedDocumentStatus(document: PartnerDocument): DocumentStatus {
  if (document.status === 'Verified' && document.expiresAt && new Date(document.expiresAt).getTime() <= Date.now()) return 'Expired'
  return document.status
}

/**
 * Directory verification state. A delivery_app account approved through KYC is
 * verified even though the admin record has no separate local document rows.
 */
export function partnerVerification(data: OperationsState, partner: Partner): PartnerVerificationStatus {
  const liveRecord = partner.partnerAppUid
    ? data.partnerAppRecords.find((record) => record.id === partner.partnerAppUid)
    : undefined
  if (isLivePartnerApproved(liveRecord)) return 'Verified'
  const liveStatus = liveApplicationStatus(liveRecord?.applicationStatus)
  if (liveStatus === 'Rejected') return 'Attention Required'
  if (liveStatus === 'Submitted') {
    const liveDocuments = data.partnerAppDocuments.find((document) => document.id === liveRecord!.id)
    if (!liveDocuments) return 'Under Review'
    const blocked = liveDocumentsBlocked(liveRecord, liveDocuments)
    if (!blocked) return 'Under Review'
    if (blocked.includes('has not been submitted')) return 'Incomplete'
    return 'Attention Required'
  }
  const mandatory = data.settings.requiredDocuments.map((type) => data.documents.find((document) => document.partnerId === partner.id && document.type === type))
  if (mandatory.every((document) => document && isDocumentCurrent(document))) return 'Verified'
  if (mandatory.some((document) => document && ['Rejected', 'Expired'].includes(displayedDocumentStatus(document)))) return 'Attention Required'
  if (mandatory.some((document) => document && ['Under Review', 'Submitted'].includes(displayedDocumentStatus(document)))) return 'Under Review'
  return 'Incomplete'
}

/**
 * One row in the KYC Review queue. Admin applications and live delivery_app
 * onboarding records share the same shape so the Administrator reviews one
 * queue instead of switching between two screens.
 */
export interface KycQueueItem {
  key: string
  source: 'admin' | 'delivery_app'
  applicationId: string | null
  recordId: string | null
  partnerId: string | null
  partnerAppUid: string | null
  applicantName: string
  businessName: string
  contact: string
  vehicle: string
  serviceAreas: string[]
  submittedAt: string
  documents: DocumentType[]
  documentsKnown: boolean
  status: KycDecisionStatus
  /** True when a rejected application was resubmitted from delivery_app. */
  resubmitted: boolean
  reviewedBy: string | null
  reviewedAt: string | null
  decisionReason: string | null
}

/** Maps delivery_app's onboarding status onto the admin decision states. */
export function liveApplicationStatus(value: string | null | undefined): KycDecisionStatus | null {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'submitted' || normalized === 'under_review' || normalized === 'pending') return 'Submitted'
  if (normalized === 'approved') return 'Approved'
  if (normalized === 'rejected') return 'Rejected'
  return null
}

function fieldValue(record: PartnerAppRecord, keys: string[]) {
  for (const key of keys) {
    const value = record.fields[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function linkedPartner(data: OperationsState, record: PartnerAppRecord): Partner | undefined {
  return data.partners.find((partner) => partner.partnerAppUid === record.id)
    ?? data.partners.find((partner) => partner.id === record.partnerId)
}

function applicationItem(data: OperationsState, application: PartnerApplication): KycQueueItem {
  // delivery_app allows a partner to re-apply after a rejection. A newer live
  // record means the decision must be revisited instead of staying final.
  const liveRecord = application.partnerAppUid
    ? data.partnerAppRecords.find((record) => record.id === application.partnerAppUid)
    : undefined
  const resubmitted = Boolean(liveRecord)
    && application.status === 'Rejected'
    && liveApplicationStatus(liveRecord!.applicationStatus) === 'Submitted'
    && Boolean(liveRecord!.updatedAt)
    && new Date(liveRecord!.updatedAt!).getTime() > new Date(application.reviewedAt ?? 0).getTime()
  return {
    key: `application:${application.id}`,
    source: 'admin',
    applicationId: application.id,
    recordId: application.partnerAppUid,
    partnerId: application.partnerId,
    partnerAppUid: application.partnerAppUid,
    applicantName: application.applicantName,
    businessName: application.businessName,
    contact: application.maskedEmail,
    vehicle: application.vehicle,
    serviceAreas: [...application.serviceAreas],
    submittedAt: resubmitted && liveRecord?.updatedAt ? liveRecord.updatedAt : application.submittedAt,
    documents: [...application.documents],
    documentsKnown: true,
    status: resubmitted ? 'Submitted' : application.status,
    resubmitted,
    reviewedBy: resubmitted ? null : application.reviewedBy,
    reviewedAt: resubmitted ? null : application.reviewedAt,
    decisionReason: resubmitted ? null : application.decisionReason,
  }
}

function recordItem(data: OperationsState, record: PartnerAppRecord, status: KycDecisionStatus): KycQueueItem | null {
  const partner = linkedPartner(data, record)
  // The local application is the authoritative review row when one exists.
  if (partner && data.applications.some((application) => application.partnerId === partner.id)) return null

  const fallbackPartnerId = record.partnerId && /^DP-\d{4}$/.test(record.partnerId) ? record.partnerId : null
  const hasApplication = status !== 'KYC pending'
  const namedApplicant = Boolean(record.name.trim()) && record.name !== record.id

  return {
    key: `record:${record.id}`,
    source: 'delivery_app',
    applicationId: null,
    recordId: record.id,
    partnerId: partner?.id ?? fallbackPartnerId,
    partnerAppUid: record.id,
    // A partner document created at sign-in only has the verified phone
    // number, so show that until onboarding writes the applicant name.
    applicantName: namedApplicant ? record.name : record.phone ?? 'New delivery partner',
    businessName: hasApplication
      ? fieldValue(record, ['businessName', 'business', 'company']) ?? 'delivery_app onboarding'
      : 'Onboarding in progress',
    contact: record.phone ?? record.email ?? 'Not provided',
    vehicle: record.vehicle ?? (hasApplication ? '—' : 'Not selected'),
    serviceAreas: [...record.serviceAreas],
    submittedAt: record.updatedAt ?? record.syncedAt,
    documents: [],
    documentsKnown: false,
    status,
    resubmitted: false,
    reviewedBy: fieldValue(record, ['reviewedBy', 'reviewed_by']),
    reviewedAt: fieldValue(record, ['reviewedAt', 'reviewed_at']),
    decisionReason: fieldValue(record, ['rejectionReason', 'decisionReason', 'rejection_reason', 'adminReviewReason']),
  }
}

/**
 * Builds the single KYC Review queue from admin applications plus any synced
 * delivery_app onboarding records that do not yet have a local application.
 * Sign-in-only records are excluded until onboarding data is submitted, so
 * the queue contains actual applications rather than every Firebase account.
 */
export function buildKycQueue(data: OperationsState): KycQueueItem[] {
  // Production KYC is sourced from the currently synchronized partner app;
  // stale local rows are excluded. The demo keeps its seeded applications so
  // the queue remains usable without a live Firebase connection.
  const liveApplicationIds = new Set(data.partnerAppRecords.map((record) => record.id))
  const items = data.applications
    .filter((application) => {
      const live = !application.demoRecord && Boolean(application.partnerAppUid && liveApplicationIds.has(application.partnerAppUid))
      return demoModeEnabled ? application.demoRecord || live : live
    })
    .map((application) => applicationItem(data, application))
  for (const record of data.partnerAppRecords) {
    if (data.applications.some((application) => application.partnerAppUid === record.id)) continue
    const namedApplicant = Boolean(record.name.trim()) && record.name !== record.id
    const applicationStatus = liveApplicationStatus(record.applicationStatus)
    // A Firebase account is not a KYC application. The partner app must write
    // an explicit application status when onboarding is submitted.
    if (!applicationStatus) continue
    const status = namedApplicant ? applicationStatus : 'KYC pending'
    const item = recordItem(data, record, status)
    if (item) items.push(item)
  }
  return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

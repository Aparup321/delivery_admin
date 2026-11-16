import type {
  DocumentType,
  OperationsState,
  Partner,
  PartnerApplication,
  PartnerAppRecord,
} from './model.ts'

export type KycDecisionStatus = 'Submitted' | 'Approved' | 'Rejected'

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
  // A delivery_app account created at sign-in has no applicant name yet. It is
  // not an onboarding application until the partner completes the wizard.
  if (!record.name.trim() || record.name === record.id) return null

  const partner = linkedPartner(data, record)
  // The local application is the authoritative review row when one exists.
  if (partner && data.applications.some((application) => application.partnerId === partner.id)) return null

  const fallbackPartnerId = record.partnerId && /^DP-\d{4}$/.test(record.partnerId) ? record.partnerId : null

  return {
    key: `record:${record.id}`,
    source: 'delivery_app',
    applicationId: null,
    recordId: record.id,
    partnerId: partner?.id ?? fallbackPartnerId,
    partnerAppUid: record.id,
    applicantName: record.name,
    businessName: fieldValue(record, ['businessName', 'business', 'company']) ?? 'delivery_app onboarding',
    contact: record.email ?? record.phone ?? 'Not provided',
    vehicle: record.vehicle ?? '—',
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
 */
export function buildKycQueue(data: OperationsState): KycQueueItem[] {
  const items = data.applications.map((application) => applicationItem(data, application))
  for (const record of data.partnerAppRecords) {
    if (data.applications.some((application) => application.partnerAppUid === record.id)) continue
    const status = liveApplicationStatus(record.applicationStatus)
    if (!status) continue
    const item = recordItem(data, record, status)
    if (item) items.push(item)
  }
  return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

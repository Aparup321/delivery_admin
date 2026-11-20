/**
 * Maps Administrator audit entries to delivery_app Firestore writes.
 *
 * Keeping this mapping outside the React provider makes the approve/reject and
 * suspend/restore write-through rules usable by the provider, tests, and the
 * live verification script without rendering React.
 */

import type { AuditLogEntry, OperationsState } from '../domain/model.ts'

export type PartnerAppWriteIntent =
  | {
    kind: 'application'
    targetType: 'Application'
    targetId: string
    partnerAppUid: string
    applicationId: string
    adminPartnerId: string | null
    decision: 'Approved' | 'Rejected'
    reason: string
    reviewedBy: string
    at: string
  }
  | {
    kind: 'account'
    targetType: 'Partner'
    targetId: string
    partnerAppUid: string
    adminPartnerId: string | null
    active: boolean
    reason: string
    updatedBy: string
    /** Timed suspension window mirrored to delivery_app; null when reinstating. */
    suspendedUntil: string | null
    suspensionDays: number | null
    at: string
  }

/**
 * Turns the same audit entries that record an Administrator's decision into
 * the write-through request for delivery_app. Anything without a linked
 * Firestore document is intentionally skipped.
 */
export function buildPartnerAppWriteIntent(data: OperationsState, log: AuditLogEntry): PartnerAppWriteIntent | null {
  if (log.eventType === 'Application approved' || log.eventType === 'Application rejected') {
    const application = data.applications.find((item) => item.id === log.targetId)
    if (!application?.partnerAppUid) return null
    return {
      kind: 'application',
      targetType: 'Application',
      targetId: application.id,
      partnerAppUid: application.partnerAppUid,
      applicationId: application.id,
      adminPartnerId: application.partnerId,
      decision: log.eventType === 'Application approved' ? 'Approved' : 'Rejected',
      reason: application.decisionReason ?? log.reason,
      reviewedBy: log.operator,
      at: log.timestamp,
    }
  }

  if (log.eventType === 'Partner suspended' || log.eventType === 'Partner restricted') {
    const partner = data.partners.find((item) => item.id === log.targetId)
    if (!partner?.partnerAppUid) return null
    return {
      kind: 'account',
      targetType: 'Partner',
      targetId: partner.id,
      partnerAppUid: partner.partnerAppUid,
      adminPartnerId: partner.id,
      active: false,
      reason: partner.suspendedReason ?? partner.restrictedReason ?? log.reason,
      updatedBy: log.operator,
      suspendedUntil: partner.suspendedUntil,
      suspensionDays: partner.suspensionDays,
      at: log.timestamp,
    }
  }

  if (log.eventType === 'Partner suspension expired') {
    const partner = data.partners.find((item) => item.id === log.targetId)
    if (!partner?.partnerAppUid) return null
    return {
      kind: 'account',
      targetType: 'Partner',
      targetId: partner.id,
      partnerAppUid: partner.partnerAppUid,
      adminPartnerId: partner.id,
      active: true,
      reason: log.reason,
      updatedBy: log.operator,
      suspendedUntil: null,
      suspensionDays: null,
      at: log.timestamp,
    }
  }

  if (log.eventType === 'Partner eligibility changed'
    && ['Restricted', 'Suspended'].includes(log.previousValue)
    && ['Available', 'On Delivery', 'Offline'].includes(log.newValue)) {
    const partner = data.partners.find((item) => item.id === log.targetId)
    if (!partner?.partnerAppUid) return null
    const application = data.applications.find((item) => item.partnerId === partner.id)
    const cached = data.partnerAppRecords.find((item) => item.id === partner.partnerAppUid)
    const approved = application?.status === 'Approved' || cached?.applicationStatus?.toLowerCase() === 'approved'
    if (!approved) return null
    return {
      kind: 'account',
      targetType: 'Partner',
      targetId: partner.id,
      partnerAppUid: partner.partnerAppUid,
      adminPartnerId: partner.id,
      active: true,
      reason: log.reason,
      updatedBy: log.operator,
      suspendedUntil: null,
      suspensionDays: null,
      at: log.timestamp,
    }
  }

  return null
}

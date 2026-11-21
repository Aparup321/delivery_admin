/**
 * Maps Administrator audit entries to delivery_app Firestore writes.
 *
 * Keeping this mapping outside the React provider makes the approve/reject and
 * suspend/restore write-through rules usable by the provider, tests, and the
 * live verification script without rendering React.
 */

import { coordinateDistanceKm, estimateEtaMinutes, estimatePartnerEarnings } from '../domain/estimates.ts'
import type { AuditLogEntry, OperationsState } from '../domain/model.ts'
import { serviceAreaCoordinate } from '../domain/serviceAreas.ts'

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
    kind: 'delivery-unassign'
    targetType: 'Delivery'
    targetId: string
    deliveryId: string
    partnerAppUid: string
    reason: string
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
  | {
    kind: 'delivery-assignment'
    targetType: 'Delivery'
    targetId: string
    deliveryId: string
    partnerAppUid: string
    partnerName: string
    partnerVehicle: string
    category: 'Grocery' | 'Restaurant'
    pickupName: string
    pickupAddress: string
    pickupLatitude: number
    pickupLongitude: number
    dropName: string
    dropAddress: string
    dropLatitude: number
    dropLongitude: number
    distanceKm: number
    etaMinutes: number
    earnings: number
    itemCount: number
    paymentMode: 'Prepaid' | 'Cash on delivery'
    note: string | null
    dropOtp: string | null
    expiresAt: string
    requestedAt: string
    at: string
  }
  | {
    kind: 'delivery-cancel'
    targetType: 'Delivery'
    targetId: string
    deliveryId: string
    partnerAppUid: string
    reason: string
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

  if (log.eventType === 'Delivery unassigned') {
    const delivery = data.deliveries.find((item) => item.id === log.targetId)
    if (!delivery) return null
    const previousPartner = data.partners.find((partner) => partner.id === log.previousValue)
    if (!previousPartner?.partnerAppUid) return null
    return {
      kind: 'delivery-unassign',
      targetType: 'Delivery',
      targetId: delivery.id,
      deliveryId: delivery.id,
      partnerAppUid: previousPartner.partnerAppUid,
      reason: log.reason,
      at: log.timestamp,
    }
  }

  // Assigning a partner publishes the offer to delivery_app's deliveries
  // collection so the assigned partner's app receives it live. Reassignments
  // replace partnerUid, which removes the offer from the previous partner.
  if (log.eventType === 'Delivery assigned' || log.eventType === 'Delivery reassigned') {
    const delivery = data.deliveries.find((item) => item.id === log.targetId)
    const assignment = data.assignments.find(
      (item) => item.deliveryId === log.targetId && item.status === 'Active',
    )
    if (!delivery || !assignment) return null
    const partner = data.partners.find((item) => item.id === assignment.partnerId)
    if (!partner?.partnerAppUid) return null

    const pickupCoordinate = delivery.pickupLocation ?? serviceAreaCoordinate(delivery.pickup)
    const dropCoordinate = delivery.dropLocation ?? serviceAreaCoordinate(delivery.drop)
    const distanceKm = coordinateDistanceKm(pickupCoordinate, dropCoordinate)
    const instructions = delivery.specialInstructions.trim()
    const expiresAt = new Date(
      new Date(log.timestamp).getTime() + data.settings.offerTimeoutMinutes * 60_000,
    ).toISOString()

    return {
      kind: 'delivery-assignment',
      targetType: 'Delivery',
      targetId: delivery.id,
      deliveryId: delivery.id,
      partnerAppUid: partner.partnerAppUid,
      partnerName: partner.name,
      partnerVehicle: partner.vehicle,
      category: delivery.category ?? 'Grocery',
      pickupName: delivery.pickup,
      pickupAddress: delivery.pickupAddress,
      pickupLatitude: pickupCoordinate.latitude,
      pickupLongitude: pickupCoordinate.longitude,
      dropName: delivery.drop,
      dropAddress: delivery.dropAddress,
      dropLatitude: dropCoordinate.latitude,
      dropLongitude: dropCoordinate.longitude,
      distanceKm,
      etaMinutes: estimateEtaMinutes(distanceKm),
      earnings: delivery.partnerEarnings ?? estimatePartnerEarnings(distanceKm),
      itemCount: delivery.itemCount ?? 1,
      paymentMode: delivery.paymentMode ?? 'Prepaid',
      note: instructions && instructions !== 'No special instructions' ? instructions : null,
      dropOtp: assignment.dropOtp,
      expiresAt,
      requestedAt: log.timestamp,
      at: log.timestamp,
    }
  }

  // Cancelling an assigned delivery closes the shared document so the
  // partner's active job ends in their app as well.
  if (log.eventType === 'Delivery cancelled') {
    const assignment = data.assignments
      .filter((item) => item.deliveryId === log.targetId)
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))[0]
    const partner = assignment
      ? data.partners.find((item) => item.id === assignment.partnerId)
      : undefined
    if (!partner?.partnerAppUid) return null

    return {
      kind: 'delivery-cancel',
      targetType: 'Delivery',
      targetId: log.targetId,
      deliveryId: log.targetId,
      partnerAppUid: partner.partnerAppUid,
      reason: log.reason,
      at: log.timestamp,
    }
  }

  return null
}

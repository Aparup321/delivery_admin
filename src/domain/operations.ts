import type { Delivery, DeliveryStatus, OperationsState, Partner, PartnerAppRecord, PartnerDocument } from './model.ts'

/**
 * Older delivery_app accounts may only have `status: active` and no
 * `applicationStatus`. An explicit application status always wins; the active
 * fallback keeps those legacy approved accounts usable.
 */
export function isLivePartnerApproved(record: PartnerAppRecord | undefined) {
  if (!record) return false
  const applicationStatus = (record.applicationStatus ?? '').trim().toLowerCase()
  if (applicationStatus) return applicationStatus === 'approved'
  return ['active', 'approved'].includes((record.status ?? '').trim().toLowerCase())
}

export interface EligibilityResult {
  eligible: boolean
  reasons: string[]
  validDocuments: number
  requiredDocuments: number
  currentAssignment: string | null
}

export function isDocumentCurrent(document: PartnerDocument, now = Date.now()) {
  return document.status === 'Verified' && (!document.expiresAt || new Date(document.expiresAt).getTime() > now)
}

/** Next free admin partner ID in the DP-0000 series. */
export function nextPartnerId(state: OperationsState) {
  const numbers = state.partners
    .map((partner) => Number(partner.id.replace(/\D/g, '')))
    .filter(Number.isFinite)
  return `DP-${String(Math.max(0, ...numbers) + 1).padStart(4, '0')}`
}

export function getPartnerEligibility(state: OperationsState, partner: Partner, delivery: Delivery, now = Date.now()): EligibilityResult {
  const reasons: string[] = []
  const documents = state.documents.filter((document) => document.partnerId === partner.id)
  const required = state.settings.requiredDocuments
  const liveRecord = partner.partnerAppUid
    ? state.partnerAppRecords.find((record) => record.id === partner.partnerAppUid)
    : undefined
  const liveApplicationStatus = (liveRecord?.applicationStatus ?? '').trim().toLowerCase()
  const liveApplicationApproved = isLivePartnerApproved(liveRecord)
  const liveAvailability = String(liveRecord?.fields.availability ?? '').trim().toLowerCase()
  const validDocuments = required.filter((type) => documents.some((document) => document.type === type && isDocumentCurrent(document, now))).length
  const activeAssignment = getActiveAssignment(state, partner.id)

  const liveOnline = liveRecord?.isOnline === true
    || ['online', 'available'].includes((liveRecord?.status ?? '').trim().toLowerCase())
    || ['online', 'available'].includes(liveAvailability)
  const liveOffline = Boolean(liveRecord)
    && (liveRecord?.isOnline === false || liveAvailability === 'offline')
    && !liveOnline
  const liveBusy = ['on delivery', 'busy'].includes(liveAvailability)

  if (partner.availability === 'Restricted') reasons.push(`Partner is restricted${partner.restrictedReason ? `: ${partner.restrictedReason}` : ''}`)
  if (partner.availability === 'Suspended') reasons.push(`Partner is suspended${partner.suspendedReason ? `: ${partner.suspendedReason}` : ''}`)
  if (liveRecord && liveApplicationStatus && !liveApplicationApproved) {
    reasons.push(`delivery_app application is ${liveApplicationStatus}`)
  }
  if ((liveRecord?.status ?? '').trim().toLowerCase() === 'paused') reasons.push('delivery_app account is paused')
  // The live presence heartbeat is the source of truth for online state. A
  // stale local Offline value must not block an actually online partner, and
  // a stale local On Delivery value must not block a partner with no active
  // assignment. A live "On Delivery" signal still blocks if another system
  // has the partner busy outside this console.
  if ((partner.availability === 'Offline' && !liveOnline) || liveOffline) {
    reasons.push(!partner.partnerAppUid
      ? 'Partner is offline'
      : !liveRecord
        ? 'No live presence record; refresh partner data'
        : 'Partner is offline in delivery_app')
  }
  if (liveBusy && !activeAssignment) reasons.push('Partner is already on an active delivery')

  if (state.settings.requireVerifiedDocuments && !liveApplicationApproved) {
    for (const type of required) {
      const document = documents.find((record) => record.type === type)
      if (!document || document.status === 'Missing') reasons.push(`${type} is missing`)
      else if (document.status !== 'Verified') reasons.push(`${type} is ${document.status.toLowerCase()}`)
      else if (document.expiresAt && new Date(document.expiresAt).getTime() <= now) reasons.push(`${type} has expired`)
    }
  }

  if (delivery.vehicleRequirement !== 'Any' && partner.vehicle !== delivery.vehicleRequirement) {
    reasons.push(`${delivery.packageSize} package requires a ${delivery.vehicleRequirement.toLowerCase()}`)
  }
  if (state.settings.enforceVehicleCompatibility && !vehicleCanCarry(partner.vehicle, delivery.packageSize)) {
    reasons.push(`${partner.vehicle} is not compatible with a ${delivery.packageSize.toLowerCase()} package`)
  }
  if (state.settings.requireServiceAreaMatch && partner.serviceAreas.length > 0) {
    const areaKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const deliveryAreas = [delivery.pickup, delivery.drop, delivery.pickupAddress, delivery.dropAddress]
      .map(areaKey)
      .filter(Boolean)
    // Delivery pickup/drop can be a full geocoded address while partner areas
    // are short locality names. Use containment rather than exact equality.
    const serves = partner.serviceAreas.some((area) => {
      const key = areaKey(area)
      return Boolean(key) && deliveryAreas.some((text) => text.includes(key))
    })
    if (!serves) reasons.push('Service area does not include pickup or drop area')
  }

  if (activeAssignment && activeAssignment.deliveryId !== delivery.id) {
    const otherDelivery = state.deliveries.find((item) => item.id === activeAssignment.deliveryId)
    reasons.push(`Already assigned to ${otherDelivery?.id ?? activeAssignment.deliveryId}`)
  }
  if (activeAssignment?.deliveryId === delivery.id) reasons.push('Already assigned to this delivery')

  return {
    eligible: reasons.length === 0,
    reasons,
    validDocuments,
    requiredDocuments: required.length,
    currentAssignment: activeAssignment?.deliveryId ?? null,
  }
}

export function vehicleCanCarry(vehicle: Partner['vehicle'], packageSize: Delivery['packageSize']) {
  if (packageSize === 'Small') return true
  if (packageSize === 'Medium') return vehicle === 'Bike' || vehicle === 'Scooter' || vehicle === 'Van'
  if (packageSize === 'Large') return vehicle === 'Van'
  return vehicle === 'Van'
}

/**
 * Whether the partner has accepted or started a delivery. A live document is
 * authoritative. Without one, only an active assignment can be accepted — an
 * unassigned delivery must never lock its Assign/Reassign/Remove actions.
 */
export function hasPartnerAccepted(
  delivery: Pick<Delivery, 'status' | 'liveStatus'>,
  liveNativeStatus: string | null | undefined,
  hasActiveAssignment: boolean,
) {
  if (liveNativeStatus) return !['assigned', 'rejected', 'cancelled'].includes(liveNativeStatus)
  if (!hasActiveAssignment) return false
  if (delivery.liveStatus) return !['assigned', 'rejected', 'cancelled'].includes(delivery.liveStatus)
  return delivery.status === 'In Transit' || delivery.status === 'Completed'
}

export function getActiveAssignment(state: OperationsState, partnerId: string) {
  return state.assignments.find((assignment) => {
    if (assignment.partnerId !== partnerId || assignment.status !== 'Active') return false
    // A completed or cancelled delivery must not keep a partner blocked when
    // an older assignment release was missed.
    const delivery = state.deliveries.find((item) => item.id === assignment.deliveryId)
    return !delivery || (delivery.status !== 'Completed' && delivery.status !== 'Cancelled')
  }) ?? null
}

export function getDeliveryStatus(delivery: Delivery): DeliveryStatus {
  return delivery.status
}

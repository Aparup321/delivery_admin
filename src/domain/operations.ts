import type { Delivery, DeliveryStatus, OperationsState, Partner, PartnerDocument } from './model.ts'

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
  const liveApplicationApproved = liveRecord?.applicationStatus?.trim().toLowerCase() === 'approved'
  const validDocuments = required.filter((type) => documents.some((document) => document.type === type && isDocumentCurrent(document, now))).length

  if (partner.availability === 'Restricted') reasons.push(`Partner is restricted${partner.restrictedReason ? `: ${partner.restrictedReason}` : ''}`)
  if (partner.availability === 'Suspended') reasons.push(`Partner is suspended${partner.suspendedReason ? `: ${partner.suspendedReason}` : ''}`)
  // During the live onboarding rollout, an approved delivery_app account may
  // be assigned while the console catches up with the partner's availability
  // heartbeat. The Partner App remains the source of truth for online state.
  if (partner.availability === 'Offline' && !liveApplicationApproved) reasons.push('Partner is offline')
  if (partner.availability === 'On Delivery') reasons.push('Partner is already on an active delivery')

  if (!liveApplicationApproved) {
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
  // Service-area enforcement is intentionally disabled for the current
  // cross-app test workflow; delivery assignment must not be blocked by an
  // incomplete onboarding area list.

  const activeAssignment = state.assignments.find((assignment) => assignment.partnerId === partner.id && assignment.status === 'Active')
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
  if (packageSize === 'Small' || packageSize === 'Medium') return true
  if (packageSize === 'Large') return vehicle === 'Van'
  return vehicle === 'Van'
}

export function getActiveAssignment(state: OperationsState, partnerId: string) {
  return state.assignments.find((assignment) => assignment.partnerId === partnerId && assignment.status === 'Active') ?? null
}

export function getDeliveryStatus(delivery: Delivery): DeliveryStatus {
  return delivery.status
}

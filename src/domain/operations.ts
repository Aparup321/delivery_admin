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

export function getPartnerEligibility(state: OperationsState, partner: Partner, delivery: Delivery, now = Date.now()): EligibilityResult {
  const reasons: string[] = []
  const documents = state.documents.filter((document) => document.partnerId === partner.id)
  const required = state.settings.requiredDocuments
  const validDocuments = required.filter((type) => documents.some((document) => document.type === type && isDocumentCurrent(document, now))).length

  if (partner.availability === 'Restricted') reasons.push(`Partner is restricted${partner.restrictedReason ? `: ${partner.restrictedReason}` : ''}`)
  if (partner.availability === 'Suspended') reasons.push(`Partner is suspended${partner.suspendedReason ? `: ${partner.suspendedReason}` : ''}`)
  if (partner.availability === 'Offline') reasons.push('Partner is offline')
  if (partner.availability === 'On Delivery') reasons.push('Partner is already on an active delivery')

  for (const type of required) {
    const document = documents.find((record) => record.type === type)
    if (!document || document.status === 'Missing') reasons.push(`${type} is missing`)
    else if (document.status !== 'Verified') reasons.push(`${type} is ${document.status.toLowerCase()}`)
    else if (document.expiresAt && new Date(document.expiresAt).getTime() <= now) reasons.push(`${type} has expired`)
  }

  if (delivery.vehicleRequirement !== 'Any' && partner.vehicle !== delivery.vehicleRequirement) {
    reasons.push(`${delivery.packageSize} package requires a ${delivery.vehicleRequirement.toLowerCase()}`)
  }
  if (state.settings.enforceVehicleCompatibility && !vehicleCanCarry(partner.vehicle, delivery.packageSize)) {
    reasons.push(`${partner.vehicle} is not compatible with a ${delivery.packageSize.toLowerCase()} package`)
  }
  if (state.settings.requireServiceAreaMatch && !partner.serviceAreas.some((area) => area === delivery.pickup || area === delivery.drop)) {
    reasons.push('Service area does not include pickup or drop area')
  }

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

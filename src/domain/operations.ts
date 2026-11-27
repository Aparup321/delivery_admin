import type { Delivery, DeliveryLocation, DeliveryStatus, OperationsState, Partner, PartnerAppRecord, PartnerDocument } from './model.ts'

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

/**
 * delivery_app onboarding collects a city but no separate service-area list.
 * Use the submitted city as the service area so KYC Review shows the same
 * value before approval that the new partner record uses after approval.
 */
export function liveServiceAreas(record: PartnerAppRecord | undefined) {
  if (!record) return []
  if (record.serviceAreas.length) return [...record.serviceAreas]
  const city = typeof record.fields.city === 'string' ? record.fields.city.trim() : ''
  return city ? [city] : []
}

/** A partner can accept nearby work after delivering outside their home area. */
const CURRENT_AREA_RADIUS_KM = 12
const CURRENT_LOCATION_MAX_AGE_MS = 2 * 60 * 60_000
// delivery_app heartbeats presence once a minute. Three missed beats means the
// app is closed, backgrounded too long, or offline; it must not remain assignable.
const PRESENCE_TTL_MS = 3 * 60_000

export type LivePresenceState = 'online' | 'offline' | 'stale' | 'unknown'

function presenceTimestamp(record: PartnerAppRecord) {
  const stamp = record.fields.presenceUpdatedAt
    ?? record.fields.lastSeen
    ?? record.fields.lastLocationUpdatedAt
    ?? record.fields['lastLocation.updatedAt']
  if (!stamp) return null
  const time = Date.parse(stamp)
  return Number.isFinite(time) ? time : null
}

/** Presence is only usable while the heartbeat is fresh. */
export function livePresenceState(record: PartnerAppRecord | undefined, now = Date.now()): LivePresenceState {
  if (!record) return 'unknown'
  const availability = String(record.fields.availability ?? '').trim().toLowerCase()
  const status = String(record.status ?? '').trim().toLowerCase()
  const availabilityOnline = ['online', 'available', 'on delivery', 'busy'].includes(availability)
    || ['online', 'available'].includes(status)
  const availabilityOffline = availability === 'offline'
    || ['offline', 'unavailable'].includes(status)
  const updatedAt = presenceTimestamp(record)
  const heartbeatStale = updatedAt !== null && now - updatedAt > PRESENCE_TTL_MS

  // The explicit boolean is the partner app's switch. It must win over a stale
  // availability string from an older write; otherwise an offline partner can
  // keep showing as active in the console.
  if (record.isOnline === false) return 'offline'
  if (record.isOnline === true) return heartbeatStale ? 'stale' : 'online'
  if (availabilityOffline) return 'offline'
  if (heartbeatStale) return 'offline'
  if (availabilityOnline) return 'online'
  return 'unknown'
}

export function isLivePartnerOnline(record: PartnerAppRecord | undefined, now = Date.now()) {
  return livePresenceState(record, now) === 'online'
}

function coordinatesFromRecord(record: PartnerAppRecord | undefined, now: number): DeliveryLocation | null {
  if (!record) return null
  const latitude = Number(record.fields['lastLocation.latitude'])
  const longitude = Number(record.fields['lastLocation.longitude'])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const stamp = record.fields['lastLocation.updatedAt'] ?? record.fields.lastLocationUpdatedAt
  if (stamp) {
    const updatedAt = Date.parse(stamp)
    if (Number.isFinite(updatedAt) && now - updatedAt > CURRENT_LOCATION_MAX_AGE_MS) return null
  }
  return { latitude, longitude }
}

function distanceKmBetween(left: DeliveryLocation, right: DeliveryLocation) {
  const toRadians = (value: number) => value * Math.PI / 180
  const earthRadiusKm = 6371
  const deltaLatitude = toRadians(right.latitude - left.latitude)
  const deltaLongitude = toRadians(right.longitude - left.longitude)
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(left.latitude)) * Math.cos(toRadians(right.latitude)) * Math.sin(deltaLongitude / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a))
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

  const livePresence = livePresenceState(liveRecord, now)
  const liveOnline = livePresence === 'online'
  const liveOffline = livePresence === 'offline' || livePresence === 'stale'
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
        : livePresence === 'stale'
          ? 'Partner presence is stale; ask them to reopen delivery_app'
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
    const deliveryText = [delivery.pickup, delivery.drop, delivery.pickupAddress, delivery.dropAddress].filter(Boolean).join(' ')
    const deliveryAreas = [delivery.pickup, delivery.drop, delivery.pickupAddress, delivery.dropAddress]
      .map(areaKey)
      .filter(Boolean)
    // Delivery pickup/drop can be a full geocoded address while partner areas
    // are short locality names. Use containment rather than exact equality.
    const areaMatch = partner.serviceAreas.some((area) => {
      const key = areaKey(area)
      return Boolean(key) && deliveryAreas.some((text) => text.includes(key))
    })
    // Onboarding stores a city-level service area (for example "kolkata").
    // When the partner's submitted pincode and the delivery pincode share the
    // same 5-digit district prefix, the partner covers that nearby locality.
    const partnerPincode = String(liveRecord?.fields.pincode ?? '').replace(/\D/g, '').slice(0, 6)
    const deliveryPincodes = deliveryText.match(/\b\d{6}\b/g) ?? []
    const pincodeMatch = partnerPincode.length === 6
      && deliveryPincodes.some((pincode) => pincode === partnerPincode || pincode.slice(0, 5) === partnerPincode.slice(0, 5))
    // The home service area is not a tether. Once a partner has delivered to
    // another locality, a recent live position or that drop-off point becomes
    // their current operating area for the next pickup.
    const lastCompletedDelivery = state.assignments
      .filter((assignment) => assignment.partnerId === partner.id && assignment.status === 'Completed')
      .sort((left, right) => (right.releasedAt ?? '').localeCompare(left.releasedAt ?? ''))
      .map((assignment) => state.deliveries.find((item) => item.id === assignment.deliveryId))
      .find((item): item is Delivery => Boolean(item))
    const livePosition = coordinatesFromRecord(liveRecord, now)
    const currentPosition = livePosition ?? lastCompletedDelivery?.dropLocation ?? null
    const locationMatch = Boolean(currentPosition)
      && [delivery.pickupLocation, delivery.dropLocation]
        .some((location) => location && distanceKmBetween(currentPosition!, location) <= CURRENT_AREA_RADIUS_KM)
    const currentPincodes = lastCompletedDelivery
      ? [lastCompletedDelivery.drop, lastCompletedDelivery.dropAddress].join(' ').match(/\b\d{6}\b/g) ?? []
      : []
    const currentPincodeMatch = !livePosition
      && currentPincodes.some((current) => deliveryPincodes.some((pincode) => pincode === current || pincode.slice(0, 5) === current.slice(0, 5)))
    if (!areaMatch && !pincodeMatch && !locationMatch && !currentPincodeMatch) reasons.push('Service area or current location does not include pickup or drop area')
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
  // A bicycle can safely carry a normal medium grocery order. Large and extra
  // large packages still require a van.
  if (packageSize === 'Medium') {
    return vehicle === 'Bike' || vehicle === 'Scooter' || vehicle === 'Bicycle' || vehicle === 'Van'
  }
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

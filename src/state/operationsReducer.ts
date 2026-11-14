import { DELIVERY_MILESTONES, type AdminRole, type AuditEventType, type AuditLogEntry, type Delivery, type DocumentStatus, type NotificationCategory, type OperationsState, type Partner, type PartnerAppConfig, type PartnerAppRecord, type Permission } from '../domain/model.ts'
import { createDemoState } from '../domain/seed.ts'
import { getPartnerEligibility, getActiveAssignment } from '../domain/operations.ts'

export interface AppFrame {
  data: OperationsState
  feedback: { id: number; kind: 'success' | 'error' | 'info'; message: string } | null
  sequence: number
}

export type OperationAction =
  | { type: 'delivery.create'; pickup: string; drop: string; packageSize: Delivery['packageSize']; weight: number; vehicle: Delivery['vehicleRequirement']; scheduledStart: string; scheduledEnd: string; instructions: string }
  | { type: 'delivery.assign'; deliveryId: string; partnerId: string }
  | { type: 'delivery.advance'; deliveryId: string }
  | { type: 'delivery.delay'; deliveryId: string; reason: string }
  | { type: 'delivery.clear-delay'; deliveryId: string; reason: string }
  | { type: 'delivery.cancel'; deliveryId: string; reason: string }
  | { type: 'offer.create'; deliveryId: string; partnerId: string }
  | { type: 'offer.send'; offerId: string }
  | { type: 'offer.accept'; offerId: string }
  | { type: 'offer.reject'; offerId: string; reason: string }
  | { type: 'offer.expire'; offerId: string }
  | { type: 'offer.expire-due'; now: number }
  | { type: 'partner.restrict'; partnerId: string; status: 'Restricted' | 'Suspended'; reason: string }
  | { type: 'partner.restore'; partnerId: string; reason: string }
  | { type: 'partner.availability'; partnerId: string; availability: 'Available' | 'Offline'; reason: string }
  | { type: 'document.update'; documentId: string; status: DocumentStatus; reason: string; expiresAt: string | null }
  | { type: 'application.approve'; applicationId: string; note: string }
  | { type: 'application.reject'; applicationId: string; reason: string }
  | { type: 'partnerApp.save'; config: Pick<PartnerAppConfig, 'mode' | 'projectId' | 'apiKey' | 'databaseId' | 'partnersCollection' | 'endpointUrl'> }
  | { type: 'partnerApp.connected'; at: string }
  | { type: 'partnerApp.sync-result'; records: PartnerAppRecord[]; at: string }
  | { type: 'partnerApp.failed'; message: string }
  | { type: 'notification.read'; notificationId: string }
  | { type: 'notification.read-all' }
  | { type: 'settings.save'; settings: OperationsState['settings'] }
  | { type: 'user.set-role'; role: AdminRole }
  | { type: 'demo.reset' }

const permissionByAction: Partial<Record<OperationAction['type'], Permission>> = {
  'delivery.create': 'delivery-management',
  'delivery.assign': 'assignment',
  'delivery.advance': 'assignment',
  'delivery.delay': 'delivery-management',
  'delivery.clear-delay': 'delivery-management',
  'delivery.cancel': 'delivery-management',
  'offer.create': 'assignment',
  'offer.send': 'assignment',
  'offer.accept': 'assignment',
  'offer.reject': 'assignment',
  'offer.expire': 'assignment',
  'partner.restrict': 'partner-management',
  'partner.restore': 'partner-management',
  'partner.availability': 'partner-management',
  'document.update': 'document-review',
  'application.approve': 'application-review',
  'application.reject': 'application-review',
  'partnerApp.save': 'settings',
  'partnerApp.connected': 'settings',
  'partnerApp.sync-result': 'settings',
  'partnerApp.failed': 'settings',
  'notification.read': 'read',
  'notification.read-all': 'read',
  'settings.save': 'settings',
  // This switches the local demo persona; it does not create or grant a production account.
  'user.set-role': 'read',
  'demo.reset': 'admin',
}

const rolePermissions: Record<AdminRole, Permission[]> = {
  Admin: ['read', 'assignment', 'delivery-management', 'partner-management', 'document-review', 'application-review', 'settings', 'admin'],
  'Operations Manager': ['read', 'assignment', 'delivery-management', 'partner-management', 'document-review'],
  'Operations Staff': ['read', 'assignment'],
  Viewer: ['read'],
}

export function roleCan(role: AdminRole, permission: Permission) {
  return rolePermissions[role].includes(permission)
}

function uid(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${random.toUpperCase()}`
}

function requireValue(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required.`)
}

function findDelivery(data: OperationsState, id: string) {
  const delivery = data.deliveries.find((item) => item.id === id)
  if (!delivery) throw new Error(`Delivery ${id} could not be found.`)
  return delivery
}

function findPartner(data: OperationsState, id: string) {
  const partner = data.partners.find((item) => item.id === id)
  if (!partner) throw new Error(`Partner ${id} could not be found.`)
  return partner
}

function findOffer(data: OperationsState, id: string) {
  const offer = data.offers.find((item) => item.id === id)
  if (!offer) throw new Error(`Offer ${id} could not be found.`)
  return offer
}

function findDocument(data: OperationsState, id: string) {
  const document = data.documents.find((item) => item.id === id)
  if (!document) throw new Error(`Document ${id} could not be found.`)
  return document
}

function findApplication(data: OperationsState, id: string) {
  const application = data.applications.find((item) => item.id === id)
  if (!application) throw new Error(`Application ${id} could not be found.`)
  return application
}

function audit(data: OperationsState, eventType: AuditEventType, targetType: AuditLogEntry['targetType'], targetId: string, previousValue: string, newValue: string, reason: string, at: string) {
  data.auditLogs.push({
    id: uid('EVT'), eventType, operator: data.user.name, operatorRole: data.user.role,
    targetType, targetId, previousValue, newValue, timestamp: at, reason: reason.trim() || 'No additional note',
  })
}

function notify(data: OperationsState, category: NotificationCategory, title: string, message: string, path: string, recordId: string, at: string) {
  if (!data.settings.notifications[category]) return
  data.notifications.unshift({ id: uid('NTF'), category, title, message, createdAt: at, readAt: null, relatedPath: path, relatedRecordId: recordId })
}

function partnerHistory(data: OperationsState, partnerId: string, type: string, description: string, relatedDeliveryId: string | null, at: string) {
  data.partnerHistory.unshift({ id: uid('PH'), partnerId, type, description, at, actor: data.user.name, relatedDeliveryId })
}

function updatePartnerAvailability(data: OperationsState, partnerId: string) {
  const partner = findPartner(data, partnerId)
  if (partner.availability === 'Restricted' || partner.availability === 'Suspended') return
  partner.availability = data.assignments.some((assignment) => assignment.partnerId === partnerId && assignment.status === 'Active') ? 'On Delivery' : 'Available'
}

function releaseAssignment(data: OperationsState, assignmentId: string, reason: string, at: string, status: 'Released' | 'Completed' = 'Released') {
  const assignment = data.assignments.find((item) => item.id === assignmentId)
  if (!assignment || assignment.status !== 'Active') return
  assignment.status = status
  assignment.releasedAt = at
  assignment.releaseReason = reason
  updatePartnerAvailability(data, assignment.partnerId)
}

function activeOffers(data: OperationsState, deliveryId: string) {
  return data.offers.filter((offer) => offer.deliveryId === deliveryId && ['Created', 'Sent', 'Awaiting Response'].includes(offer.status))
}

function makeOffer(data: OperationsState, deliveryId: string, partnerId: string, at: string, sendNow: boolean) {
  const attempt = data.offers.filter((offer) => offer.deliveryId === deliveryId).length + 1
  const sentStates = sendNow
    ? [{ status: 'Created' as const, at }, { status: 'Sent' as const, at }, { status: 'Awaiting Response' as const, at }]
    : [{ status: 'Created' as const, at }]
  const offer = {
    id: uid('OFR'), deliveryId, partnerId,
    status: sendNow ? 'Awaiting Response' as const : 'Created' as const,
    createdAt: at,
    expiresAt: new Date(new Date(at).getTime() + data.settings.offerTimeoutMinutes * 60_000).toISOString(),
    respondedAt: null,
    attempt,
    note: sendNow ? 'Sent in local demo; awaiting simulated partner response.' : null,
    stateHistory: sentStates,
  }
  data.offers.unshift(offer)
  return offer
}

function assignPartner(data: OperationsState, deliveryId: string, partnerId: string, at: string, reason = 'Manual demo assignment') {
  const delivery = findDelivery(data, deliveryId)
  const partner = findPartner(data, partnerId)
  if (delivery.status === 'Completed') throw new Error('Completed deliveries cannot be reassigned.')
  if (delivery.status === 'Cancelled') throw new Error('Cancelled deliveries cannot be assigned.')
  const previous = data.assignments.find((assignment) => assignment.deliveryId === deliveryId && assignment.status === 'Active')
  if (previous?.partnerId === partnerId) throw new Error(`${partner.name} is already assigned to ${delivery.id}.`)
  const eligibility = getPartnerEligibility(data, partner, delivery, new Date(at).getTime())
  if (!eligibility.eligible) throw new Error(`${partner.name} is ineligible: ${eligibility.reasons.join('; ')}.`)

  if (previous) {
    const previousPartner = findPartner(data, previous.partnerId)
    const previousName = previousPartner.name
    previous.status = 'Released'
    previous.releasedAt = at
    previous.releaseReason = `Reassigned to ${partner.id}`
    partnerHistory(data, previous.partnerId, 'Assignment released', `Released from ${delivery.id} after reassignment to ${partner.name}.`, delivery.id, at)
    updatePartnerAvailability(data, previous.partnerId)
    audit(data, 'Delivery reassigned', 'Delivery', delivery.id, previousPartner.id, partner.id, `Previous partner: ${previousName}. ${reason}`, at)
  } else {
    audit(data, 'Delivery assigned', 'Delivery', delivery.id, 'Unassigned', partner.id, reason, at)
  }

  const assignment = {
    id: uid('ASN'), deliveryId, partnerId, assignedAt: at, assignedBy: data.user.name,
    status: 'Active' as const, releasedAt: null, releaseReason: null,
    attempt: data.assignments.filter((item) => item.deliveryId === deliveryId).length + 1,
  }
  data.assignments.unshift(assignment)
  delivery.assignmentId = assignment.id
  if (delivery.status !== 'Delayed') {
    if (!delivery.milestones[0]?.completedAt) {
      delivery.milestones[0] = { name: DELIVERY_MILESTONES[0], completedAt: at, completedBy: `${partner.name} · Demo` }
    }
    const inTransitStarted = delivery.milestones[2]?.completedAt || delivery.milestones[3]?.completedAt
    delivery.status = inTransitStarted ? 'In Transit' : 'Assigned'
  }
  partner.availability = 'On Delivery'
  partner.needsOperationalReview = false
  partnerHistory(data, partner.id, 'Assignment received', `${delivery.id} assigned to ${partner.name}.`, delivery.id, at)
  notify(data, 'Delivery Assigned', previous ? 'Delivery reassigned' : 'Partner assigned', `${partner.name} ${previous ? 'reassigned to' : 'assigned to'} ${delivery.id}.`, `/admin/deliveries/${delivery.id}`, delivery.id, at)
  for (const offer of activeOffers(data, deliveryId)) {
    if (offer.status !== 'Accepted') {
      offer.status = 'Cancelled'
      offer.respondedAt = at
      offer.note = 'Offer closed because the delivery was assigned.'
      offer.stateHistory.push({ status: 'Cancelled', at })
    }
  }
  return assignment
}

function fallbackAfterTimeout(data: OperationsState, deliveryId: string, at: string) {
  if (!data.settings.fallbackEnabled) return
  const attempts = data.offers.filter((offer) => offer.deliveryId === deliveryId)
  const delivery = data.deliveries.find((item) => item.id === deliveryId)
  if (!delivery || ['Completed', 'Cancelled', 'Delayed'].includes(delivery.status)) return
  if (data.settings.fallbackBehavior === 'Return to dispatch queue') return
  if (data.settings.fallbackBehavior === 'Notify operations manager') {
    notify(data, 'Unassigned Delivery', 'Operations review requested', `${deliveryId} offer timed out; the delivery remains in the dispatch queue for manager review.`, `/admin/deliveries/${deliveryId}`, deliveryId, at)
    return
  }
  if (activeOffers(data, deliveryId).length > 0) return
  if (attempts.length >= data.settings.maxAssignmentAttempts) {
    notify(data, 'Unassigned Delivery', 'Maximum offer attempts reached', `${deliveryId} remains in the dispatch queue after ${attempts.length} demo offer attempts.`, `/admin/deliveries/${deliveryId}`, deliveryId, at)
    return
  }
  const alreadyOffered = new Set(attempts.map((offer) => offer.partnerId))
  const candidate = data.partners.find((partner) => !alreadyOffered.has(partner.id) && getPartnerEligibility(data, partner, delivery, new Date(at).getTime()).eligible)
  if (candidate) {
    const offer = makeOffer(data, deliveryId, candidate.id, at, true)
    offer.note = 'Automatic next-eligible fallback offer · Demo policy enabled.'
    audit(data, 'Assignment offer created', 'Offer', offer.id, 'No active offer', `${candidate.id} · attempt ${offer.attempt}`, 'Fallback explicitly enabled in demo settings.', at)
  } else {
    notify(data, 'Unassigned Delivery', 'No eligible fallback partner', `${deliveryId} remains unassigned; no additional partner passed eligibility checks.`, `/admin/deliveries/${deliveryId}/assign`, deliveryId, at)
  }
}

function timeoutOffer(data: OperationsState, offerId: string, at: string) {
  const offer = findOffer(data, offerId)
  if (offer.status !== 'Awaiting Response') throw new Error('Only offers awaiting a response can time out.')
  offer.status = 'Timed Out'
  offer.respondedAt = at
  offer.note = 'Timed out in the local demo offer lifecycle.'
  offer.stateHistory.push({ status: 'Timed Out', at })
  audit(data, 'Assignment offer timed out', 'Offer', offer.id, 'Awaiting Response', 'Timed Out', 'Offer deadline elapsed in demo.', at)
  notify(data, 'Assignment Offer Expired', 'Assignment offer expired', `${offer.id} for ${offer.deliveryId} timed out.`, `/admin/deliveries/${offer.deliveryId}`, offer.deliveryId, at)
  fallbackAfterTimeout(data, offer.deliveryId, at)
}

function applyAction(data: OperationsState, action: OperationAction): { message: string; kind?: 'success' | 'info' | 'error' } {
  const at = new Date().toISOString()
  switch (action.type) {
    case 'delivery.create': {
      requireValue(action.pickup, 'Pickup area')
      requireValue(action.drop, 'Drop area')
      if (action.pickup.trim().toLowerCase() === action.drop.trim().toLowerCase()) throw new Error('Pickup and drop areas must be different.')
      if (!Number.isFinite(action.weight) || action.weight <= 0 || action.weight > 100) throw new Error('Estimated weight must be between 0.1 and 100 kg.')
      const numbers = data.deliveries.map((item) => Number(item.id.replace(/\D/g, ''))).filter(Number.isFinite)
      const id = `DLV-${Math.max(1048, ...numbers) + 1}`
      const starts = new Date(action.scheduledStart)
      const ends = new Date(action.scheduledEnd)
      if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) throw new Error('Choose a valid delivery window.')
      const delivery: Delivery = {
        id, pickup: action.pickup.trim(), drop: action.drop.trim(),
        pickupAddress: `Demo pickup point · ${action.pickup.trim()}`,
        dropAddress: `Demo drop point · ${action.drop.trim()}`,
        packageSize: action.packageSize, estimatedWeightKg: action.weight,
        vehicleRequirement: action.vehicle, scheduledStart: starts.toISOString(), scheduledEnd: ends.toISOString(),
        specialInstructions: action.instructions.trim() || 'No special instructions · Demo',
        createdAt: at, status: 'Unassigned', statusBeforeDelay: null, delayReason: null, assignmentId: null,
        milestones: DELIVERY_MILESTONES.map((name) => ({ name, completedAt: null, completedBy: null })),
      }
      data.deliveries.unshift(delivery)
      audit(data, 'Delivery created', 'Delivery', id, '—', 'Unassigned', 'Created as an illustrative demo delivery.', at)
      notify(data, 'Unassigned Delivery', 'New unassigned delivery', `${id} is waiting for an eligible partner.`, `/admin/deliveries/${id}/assign`, id, at)
      return { message: `${id} created in demo data.` }
    }
    case 'delivery.assign': {
      const delivery = findDelivery(data, action.deliveryId)
      const partner = findPartner(data, action.partnerId)
      assignPartner(data, delivery.id, partner.id, at)
      return { message: `${partner.name} assigned to ${delivery.id}.` }
    }
    case 'delivery.advance': {
      const delivery = findDelivery(data, action.deliveryId)
      if (delivery.status === 'Delayed') throw new Error('Resolve the delivery delay before advancing its milestone.')
      if (delivery.status === 'Cancelled') throw new Error('Cancelled deliveries cannot continue through milestones.')
      if (delivery.status === 'Completed') throw new Error('This delivery is already complete.')
      const activeAssignment = data.assignments.find((item) => item.id === delivery.assignmentId && item.status === 'Active')
      if (!activeAssignment) throw new Error('Assign a partner before updating delivery milestones.')
      const index = delivery.milestones.findIndex((milestone) => !milestone.completedAt)
      if (index < 0) throw new Error('All delivery milestones are already complete.')
      if (index === 5 && !delivery.milestones[4]?.completedAt) throw new Error('Drop Arrived must be recorded before delivery can be completed.')
      delivery.milestones[index] = { ...delivery.milestones[index], completedAt: at, completedBy: index === 5 ? data.user.name : `${findPartner(data, activeAssignment.partnerId).name} · Demo` }
      const milestoneName = delivery.milestones[index].name
      const previous = delivery.status
      if (index === 5) {
        delivery.status = 'Completed'
        activeAssignment.status = 'Completed'
        activeAssignment.releasedAt = at
        activeAssignment.releaseReason = 'Delivery completed'
        updatePartnerAvailability(data, activeAssignment.partnerId)
        notify(data, 'Delivery Completed', 'Delivery completed', `${delivery.id} has reached the Delivered milestone.`, `/admin/deliveries/${delivery.id}`, delivery.id, at)
      } else if (index >= 2) delivery.status = 'In Transit'
      else delivery.status = 'Assigned'
      audit(data, 'Delivery status changed', 'Delivery', delivery.id, previous, `${milestoneName} · ${delivery.status}`, `Milestone updated by ${data.user.name}.`, at)
      return { message: `${delivery.id}: ${milestoneName} recorded.` }
    }
    case 'delivery.delay': {
      const delivery = findDelivery(data, action.deliveryId)
      requireValue(action.reason, 'Delay reason')
      if (delivery.status === 'Completed' || delivery.status === 'Cancelled' || delivery.status === 'Delayed') throw new Error(`A ${delivery.status.toLowerCase()} delivery cannot be marked delayed.`)
      const previous = delivery.status
      delivery.statusBeforeDelay = previous
      delivery.status = 'Delayed'
      delivery.delayReason = action.reason.trim()
      audit(data, 'Delivery delayed', 'Delivery', delivery.id, previous, 'Delayed', action.reason, at)
      notify(data, 'Delivery Delayed', 'Delivery needs attention', `${delivery.id} marked delayed: ${action.reason.trim()}`, `/admin/deliveries/${delivery.id}`, delivery.id, at)
      return { message: `${delivery.id} marked delayed.` }
    }
    case 'delivery.clear-delay': {
      const delivery = findDelivery(data, action.deliveryId)
      requireValue(action.reason, 'Resolution note')
      if (delivery.status !== 'Delayed') throw new Error('This delivery is not marked delayed.')
      const previous = delivery.status
      delivery.status = delivery.statusBeforeDelay ?? (delivery.assignmentId ? 'Assigned' : 'Unassigned')
      delivery.statusBeforeDelay = null
      delivery.delayReason = null
      audit(data, 'Delivery status changed', 'Delivery', delivery.id, previous, delivery.status, action.reason, at)
      return { message: `Delay cleared for ${delivery.id}.` }
    }
    case 'delivery.cancel': {
      const delivery = findDelivery(data, action.deliveryId)
      requireValue(action.reason, 'Cancellation reason')
      if (delivery.status === 'Completed') throw new Error('Completed deliveries cannot be cancelled.')
      if (delivery.status === 'Cancelled') throw new Error('This delivery is already cancelled.')
      const previous = delivery.status
      if (delivery.assignmentId) releaseAssignment(data, delivery.assignmentId, `Cancelled: ${action.reason.trim()}`, at)
      delivery.status = 'Cancelled'
      delivery.statusBeforeDelay = null
      for (const offer of activeOffers(data, delivery.id)) {
        offer.status = 'Cancelled'
        offer.respondedAt = at
        offer.note = `Delivery cancelled: ${action.reason.trim()}`
        offer.stateHistory.push({ status: 'Cancelled', at })
      }
      audit(data, 'Delivery cancelled', 'Delivery', delivery.id, previous, 'Cancelled', action.reason, at)
      return { message: `${delivery.id} cancelled.` }
    }
    case 'offer.create': {
      const delivery = findDelivery(data, action.deliveryId)
      const partner = findPartner(data, action.partnerId)
      if (delivery.status === 'Completed' || delivery.status === 'Cancelled' || delivery.status === 'Delayed') throw new Error(`Offers cannot be created for a ${delivery.status.toLowerCase()} delivery.`)
      if (data.assignments.some((item) => item.deliveryId === delivery.id && item.status === 'Active')) throw new Error('This delivery already has an active assignment.')
      if (activeOffers(data, delivery.id).length) throw new Error('An active offer already exists for this delivery. Resolve it before creating another.')
      if (data.offers.filter((offer) => offer.deliveryId === delivery.id).length >= data.settings.maxAssignmentAttempts) throw new Error('Maximum assignment attempts reached. Review the delivery before retrying.')
      const eligibility = getPartnerEligibility(data, partner, delivery, Date.now())
      if (!eligibility.eligible) throw new Error(`${partner.name} is ineligible: ${eligibility.reasons.join('; ')}.`)
      const offer = makeOffer(data, delivery.id, partner.id, at, false)
      audit(data, 'Assignment offer created', 'Offer', offer.id, 'No offer', `Created · ${partner.id}`, 'Created in the local demo offer lifecycle.', at)
      return { message: `Offer ${offer.id} created. Send it to begin the demo response window.` }
    }
    case 'offer.send': {
      const offer = findOffer(data, action.offerId)
      if (offer.status !== 'Created' && offer.status !== 'Sent') throw new Error('Only a newly created offer can be sent.')
      offer.status = 'Awaiting Response'
      offer.expiresAt = new Date(new Date(at).getTime() + data.settings.offerTimeoutMinutes * 60_000).toISOString()
      offer.note = 'Sent in local demo; awaiting simulated partner response.'
      offer.stateHistory.push({ status: 'Sent', at }, { status: 'Awaiting Response', at })
      return { message: `${offer.id} sent in the demo; awaiting response.` }
    }
    case 'offer.accept': {
      const offer = findOffer(data, action.offerId)
      if (offer.status !== 'Awaiting Response') throw new Error('This offer is no longer awaiting a response.')
      if (new Date(offer.expiresAt).getTime() <= new Date(at).getTime()) {
        timeoutOffer(data, offer.id, at)
        return { message: `${offer.id} has expired and cannot be accepted.`, kind: 'info' }
      }
      const delivery = findDelivery(data, offer.deliveryId)
      const partner = findPartner(data, offer.partnerId)
      const eligibility = getPartnerEligibility(data, partner, delivery, new Date(at).getTime())
      if (!eligibility.eligible) throw new Error(`Offer cannot be accepted: ${eligibility.reasons.join('; ')}.`)
      offer.status = 'Accepted'
      offer.respondedAt = at
      offer.stateHistory.push({ status: 'Accepted', at })
      assignPartner(data, delivery.id, partner.id, at, `Accepted simulated offer ${offer.id}`)
      offer.status = 'Accepted'
      return { message: `${partner.name} accepted the demo offer and was assigned.` }
    }
    case 'offer.reject': {
      const offer = findOffer(data, action.offerId)
      requireValue(action.reason, 'Rejection reason')
      if (offer.status !== 'Awaiting Response') throw new Error('Only offers awaiting a response can be rejected.')
      offer.status = 'Rejected'
      offer.respondedAt = at
      offer.note = action.reason.trim()
      offer.stateHistory.push({ status: 'Rejected', at })
      audit(data, 'Assignment offer rejected', 'Offer', offer.id, 'Awaiting Response', 'Rejected', action.reason, at)
      notify(data, 'Partner Rejected Offer', 'Partner declined the offer', `${offer.partnerId} declined the offer for ${offer.deliveryId}: ${action.reason.trim()}`, `/admin/deliveries/${offer.deliveryId}`, offer.deliveryId, at)
      return { message: `Offer ${offer.id} marked rejected.` }
    }
    case 'offer.expire': {
      const offer = findOffer(data, action.offerId)
      if (offer.status !== 'Awaiting Response') throw new Error('Only offers awaiting a response can time out.')
      timeoutOffer(data, offer.id, at)
      return { message: `Timeout simulated for ${offer.id}.` }
    }
    case 'partner.restrict': {
      const partner = findPartner(data, action.partnerId)
      requireValue(action.reason, 'Restriction reason')
      if (partner.availability === action.status) throw new Error(`${partner.name} is already ${action.status.toLowerCase()}.`)
      if (partner.availability === 'Suspended' && action.status === 'Restricted') throw new Error('Restore the partner before changing a suspension to a restriction.')
      const previous = partner.availability
      partner.availability = action.status
      partner.restrictedReason = action.status === 'Restricted' ? action.reason.trim() : null
      partner.suspendedReason = action.status === 'Suspended' ? action.reason.trim() : null
      const active = getActiveAssignment(data, partner.id)
      partner.needsOperationalReview = Boolean(active)
      partnerHistory(data, partner.id, action.status, `${action.status}: ${action.reason.trim()}${active ? `. Existing ${active.deliveryId} assignment flagged for review.` : ''}`, active?.deliveryId ?? null, at)
      const event = action.status === 'Restricted' ? 'Partner restricted' : 'Partner suspended'
      audit(data, event, 'Partner', partner.id, previous, action.status, action.reason, at)
      audit(data, 'Partner eligibility changed', 'Partner', partner.id, 'Eligible state recalculated', 'Ineligible for new offers', action.reason, at)
      const category = action.status === 'Restricted' ? 'Partner Restricted' : 'Partner Suspended'
      notify(data, category, `Partner ${action.status.toLowerCase()}`, `${partner.name} is ${action.status.toLowerCase()}: ${action.reason.trim()}`, `/admin/partners/${partner.id}`, partner.id, at)
      return { message: `${partner.name} ${action.status.toLowerCase()}. Existing assignment${active ? ` ${active.deliveryId} was flagged for review` : 's were not changed'}.` }
    }
    case 'partner.restore': {
      const partner = findPartner(data, action.partnerId)
      requireValue(action.reason, 'Reinstatement reason')
      if (partner.availability !== 'Restricted' && partner.availability !== 'Suspended') throw new Error(`${partner.name} is not restricted or suspended.`)
      const previous = partner.availability
      partner.restrictedReason = null
      partner.suspendedReason = null
      partner.availability = getActiveAssignment(data, partner.id) ? 'On Delivery' : 'Available'
      partner.needsOperationalReview = Boolean(getActiveAssignment(data, partner.id))
      partnerHistory(data, partner.id, 'Eligibility restored', `Restored from ${previous.toLowerCase()}: ${action.reason.trim()}`, getActiveAssignment(data, partner.id)?.deliveryId ?? null, at)
      audit(data, 'Partner eligibility changed', 'Partner', partner.id, previous, partner.availability, action.reason, at)
      return { message: `${partner.name} restored to ${partner.availability.toLowerCase()} status.` }
    }
    case 'partner.availability': {
      const partner = findPartner(data, action.partnerId)
      requireValue(action.reason, 'Operational note')
      if (partner.availability === 'Restricted' || partner.availability === 'Suspended') throw new Error('Restore this partner before changing availability.')
      if (action.availability === 'Available' && getActiveAssignment(data, partner.id)) throw new Error('A partner with an active delivery cannot be set available.')
      const previous = partner.availability
      partner.availability = action.availability
      partnerHistory(data, partner.id, 'Availability changed', `Availability changed from ${previous} to ${action.availability}: ${action.reason.trim()}.`, null, at)
      audit(data, 'Partner availability changed', 'Partner', partner.id, previous, action.availability, action.reason, at)
      return { message: `${partner.name} marked ${action.availability.toLowerCase()}.` }
    }
    case 'document.update': {
      const document = findDocument(data, action.documentId)
      const partner = findPartner(data, document.partnerId)
      if (action.status === 'Rejected') requireValue(action.reason, 'Rejection reason')
      const previous = document.status
      const reviewer = data.user.name
      document.status = action.status
      document.reviewer = action.status === 'Missing' ? null : reviewer
      document.rejectionReason = action.status === 'Rejected' ? action.reason.trim() : null
      document.submittedAt = action.status === 'Missing' ? null : document.submittedAt ?? at
      document.expiresAt = action.status === 'Expired' ? new Date(new Date(at).getTime() - 60_000).toISOString() : action.expiresAt
      document.history.push({ status: action.status, changedAt: at, reviewer, reason: action.reason.trim() || null })
      audit(data, 'Document verification updated', 'Document', document.id, previous, action.status, action.reason || `Reviewer: ${reviewer}`, at)
      partnerHistory(data, partner.id, 'Document verification', `${document.type} changed from ${previous} to ${action.status}${action.reason ? `: ${action.reason}` : ''}.`, null, at)
      if (action.status === 'Expired') notify(data, 'Document Expired', 'Partner document expired', `${partner.id} · ${document.type} is expired. New offers are blocked until verified.`, `/admin/partners/${partner.id}`, partner.id, at)
      if (['Missing', 'Submitted', 'Under Review', 'Rejected'].includes(action.status)) notify(data, 'Verification Required', 'Partner verification requires review', `${partner.id} · ${document.type} is ${action.status.toLowerCase()}.`, `/admin/partners/${partner.id}`, partner.id, at)
      return { message: `${document.type} for ${partner.name} updated to ${action.status}.` }
    }
    case 'application.approve': {
      const application = findApplication(data, action.applicationId)
      if (application.status !== 'Submitted') throw new Error(`${application.id} has already been decided and cannot be reviewed again.`)
      const partnerNumbers = data.partners.map((item) => Number(item.id.replace(/\D/g, ''))).filter(Number.isFinite)
      const partnerId = `DP-${String(Math.max(0, ...partnerNumbers) + 1).padStart(4, '0')}`
      const partner: Partner = {
        id: partnerId,
        name: application.applicantName,
        maskedPhone: application.maskedPhone,
        maskedEmail: application.maskedEmail,
        registeredAt: at,
        vehicle: application.vehicle,
        maskedRegistration: `WB-••-${String(2300 + data.partners.length).slice(-4)}`,
        serviceAreas: [...application.serviceAreas],
        availability: 'Offline',
        restrictedReason: null,
        suspendedReason: null,
        needsOperationalReview: false,
      }
      data.partners.unshift(partner)
      const submittedTypes = new Set(application.documents)
      data.settings.requiredDocuments.forEach((type, index) => {
        const submitted = submittedTypes.has(type)
        data.documents.push({
          id: `DOC-${partnerId.slice(-4)}-${index + 1}`,
          partnerId,
          type,
          submittedAt: submitted ? application.submittedAt : null,
          status: submitted ? 'Submitted' : 'Missing',
          expiresAt: null,
          reviewer: null,
          rejectionReason: null,
          history: submitted ? [{ status: 'Submitted', changedAt: at, reviewer: data.user.name, reason: 'Created from an approved onboarding application.' }] : [],
          demoRecord: true,
        })
      })
      const previous = application.status
      application.status = 'Approved'
      application.reviewedBy = data.user.name
      application.reviewedAt = at
      application.decisionReason = action.note.trim() || null
      application.partnerId = partnerId
      partnerHistory(data, partnerId, 'Application approved', `Onboarding application ${application.id} approved. ${partner.name} added to the partner directory with documents queued for KYC review.`, null, at)
      audit(data, 'Application approved', 'Application', application.id, previous, `Approved · ${partnerId}`, action.note || 'Approved by Administrator.', at)
      notify(data, 'Partner Application Approved', 'Onboarding application approved', `${application.applicantName} · ${application.businessName} was approved and added as ${partnerId}.`, `/admin/partners/${partnerId}`, application.id, at)
      notify(data, 'Verification Required', 'New partner documents need review', `${partnerId} has onboarding documents awaiting KYC verification.`, `/admin/partners/${partnerId}`, partnerId, at)
      return { message: `${application.id} approved. ${partner.name} added as ${partnerId}; documents are queued for KYC review.` }
    }
    case 'application.reject': {
      const application = findApplication(data, action.applicationId)
      requireValue(action.reason, 'Rejection reason')
      if (application.status !== 'Submitted') throw new Error(`${application.id} has already been decided and cannot be reviewed again.`)
      const previous = application.status
      application.status = 'Rejected'
      application.reviewedBy = data.user.name
      application.reviewedAt = at
      application.decisionReason = action.reason.trim()
      audit(data, 'Application rejected', 'Application', application.id, previous, 'Rejected', action.reason, at)
      notify(data, 'Partner Application Rejected', 'Onboarding application rejected', `${application.applicantName} · ${application.businessName}: ${action.reason.trim()}`, '/admin/kyc', application.id, at)
      return { message: `${application.id} rejected with a recorded reason.` }
    }
    case 'partnerApp.save': {
      const { mode } = action.config
      const projectId = action.config.projectId.trim()
      const apiKey = action.config.apiKey.trim()
      const databaseId = action.config.databaseId.trim() || '(default)'
      const partnersCollection = action.config.partnersCollection.trim().replace(/^\/+|\/+$/g, '')
      const endpointUrl = action.config.endpointUrl.trim()
      if (mode !== 'firestore' && mode !== 'endpoint') throw new Error('Choose a valid partner app connection type.')
      if (mode === 'firestore') {
        if (!projectId) throw new Error('Firebase project ID is required for the delivery_app connection.')
        if (!partnersCollection) throw new Error('The Firestore partners collection is required.')
      } else {
        let parsed: URL
        try {
          parsed = new URL(endpointUrl)
        } catch {
          throw new Error('Enter a valid REST endpoint URL that returns partner JSON.')
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('The partner app endpoint must use http or https.')
      }
      const previous = data.partnerApp
      const sourceChanged = previous.mode !== mode || previous.projectId !== projectId || previous.databaseId !== databaseId || previous.partnersCollection !== partnersCollection || previous.endpointUrl !== endpointUrl
      data.partnerApp = {
        mode,
        projectId,
        apiKey,
        databaseId,
        partnersCollection,
        endpointUrl,
        lastConnectedAt: sourceChanged ? null : previous.lastConnectedAt,
        lastSyncAt: sourceChanged ? null : previous.lastSyncAt,
        lastError: null,
      }
      if (sourceChanged) data.partnerAppRecords = []
      const describe = (config: PartnerAppConfig) => config.mode === 'firestore'
        ? `Firestore · ${config.projectId || 'no project'} · ${config.partnersCollection || 'no collection'}`
        : `REST · ${config.endpointUrl || 'no endpoint'}`
      audit(data, 'Partner app connection updated', 'Settings', 'partner-app', describe(previous), describe(data.partnerApp), 'Partner app connection saved by Administrator.', at)
      return { message: 'Partner app connection saved. Test the connection or sync partner data.' }
    }
    case 'partnerApp.connected': {
      data.partnerApp.lastConnectedAt = action.at
      data.partnerApp.lastError = null
      return { message: 'Partner app connection verified.', kind: 'info' }
    }
    case 'partnerApp.sync-result': {
      if (!Array.isArray(action.records)) throw new Error('Partner app records were not valid.')
      const previousCount = data.partnerAppRecords.length
      data.partnerAppRecords = action.records.slice(0, 1000)
      data.partnerApp.lastError = null
      data.partnerApp.lastSyncAt = action.at
      data.partnerApp.lastConnectedAt = action.at
      data.partnerApp.lastError = null
      audit(data, 'Partner app data synced', 'Settings', 'partner-app', `${previousCount} cached records`, `${data.partnerAppRecords.length} cached records`, 'Manual partner app sync from the connection screen.', at)
      return { message: `${data.partnerAppRecords.length} partner app record${data.partnerAppRecords.length === 1 ? '' : 's'} synced.` }
    }
    case 'partnerApp.failed': {
      data.partnerApp.lastError = action.message.trim() || 'Partner app request failed.'
      return { message: data.partnerApp.lastError, kind: 'error' }
    }
    case 'notification.read': {
      const notification = data.notifications.find((item) => item.id === action.notificationId)
      if (!notification) throw new Error('Notification could not be found.')
      notification.readAt ??= at
      return { message: 'Notification marked as read.', kind: 'info' }
    }
    case 'notification.read-all': {
      data.notifications.forEach((item) => { item.readAt ??= at })
      return { message: 'All notifications marked as read.', kind: 'info' }
    }
    case 'settings.save': {
      const next = action.settings
      if (!Number.isFinite(next.offerTimeoutMinutes) || next.offerTimeoutMinutes < 1 || next.offerTimeoutMinutes > 60) throw new Error('Offer timeout must be between 1 and 60 minutes.')
      if (!Number.isInteger(next.maxAssignmentAttempts) || next.maxAssignmentAttempts < 1 || next.maxAssignmentAttempts > 10) throw new Error('Maximum attempts must be from 1 to 10.')
      if (!Number.isFinite(next.delayThresholdMinutes) || next.delayThresholdMinutes < 1 || next.delayThresholdMinutes > 180) throw new Error('Delay threshold must be between 1 and 180 minutes.')
      const previous = JSON.stringify(data.settings)
      data.settings = structuredClone(next)
      audit(data, 'Settings modified', 'Settings', 'operations', previous, JSON.stringify(data.settings), 'Updated local demo configuration.', at)
      return { message: 'Demo settings saved locally.' }
    }
    case 'user.set-role': {
      const previous = data.user.role
      audit(data, 'Administrative role changed', 'Admin user', data.user.id, previous, action.role, 'Role changed using the local demo role selector.', at)
      data.user.role = action.role
      return { message: `Demo role changed to ${action.role}.` }
    }
    case 'demo.reset': {
      const reset = createDemoState()
      reset.auditLogs.push({
        id: uid('EVT'), eventType: 'Demo data reset', operator: data.user.name, operatorRole: data.user.role,
        targetType: 'Demo data', targetId: 'local-demo', previousValue: 'Saved local changes', newValue: 'Seed data restored',
        timestamp: at, reason: 'Reset confirmed by operator.',
      })
      reset.user = { ...reset.user, role: data.user.role }
      Object.assign(data, reset)
      return { message: 'Demo records reset to their initial state.' }
    }
    case 'offer.expire-due':
      throw new Error('Internal offer sweep must be handled by the scheduler.')
  }
}

function expireDue(data: OperationsState, now: number) {
  const expired = data.offers.filter((offer) => offer.status === 'Awaiting Response' && new Date(offer.expiresAt).getTime() <= now)
  if (!expired.length) return 0
  const at = new Date(now).toISOString()
  for (const offer of expired) timeoutOffer(data, offer.id, at)
  return expired.length
}

export function appReducer(frame: AppFrame, action: OperationAction): AppFrame {
  if (action.type === 'offer.expire-due') {
    const data = structuredClone(frame.data)
    try {
      const count = expireDue(data, action.now)
      if (!count) return frame
      return { ...frame, data, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'info', message: `${count} demo offer${count === 1 ? '' : 's'} timed out.` } }
    } catch (error) {
      return { ...frame, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'error', message: error instanceof Error ? error.message : 'Offer timeout could not be recorded.' } }
    }
  }

  const permission = permissionByAction[action.type]
  if (permission && !roleCan(frame.data.user.role, permission)) {
    const sequence = frame.sequence + 1
    return { ...frame, sequence, feedback: { id: sequence, kind: 'error', message: `Your ${frame.data.user.role} demo role cannot perform this action.` } }
  }

  const data = structuredClone(frame.data)
  try {
    const result = applyAction(data, action)
    const sequence = frame.sequence + 1
    return { data, sequence, feedback: { id: sequence, kind: result.kind ?? 'success', message: result.message } }
  } catch (error) {
    const sequence = frame.sequence + 1
    return { ...frame, sequence, feedback: { id: sequence, kind: 'error', message: error instanceof Error ? error.message : 'The demo operation could not be completed.' } }
  }
}

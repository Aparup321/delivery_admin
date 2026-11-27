import { adminUserFromAccount, normalizeAdminAccess, normalizeAdminEmail, userCan } from '../domain/admin.ts'
import { createDropOtp } from '../domain/estimates.ts'
import { DELIVERY_MILESTONES, type AdminAccount, type AdminRole, type AdminSection, type Assignment, type AuditEventType, type AuditLogEntry, type Delivery, type DeliveryMilestoneName, type DeliveryStatus, type DocumentStatus, type LiveOrderSnapshot, type NotificationCategory, type OperationsState, type Partner, type PartnerAppConfig, type PartnerAppDocument, type PartnerAppRecord, type PartnerAppTicket, type PartnerApplication, type PartnerDocumentReview, type Permission } from '../domain/model.ts'
import { createDemoState } from '../domain/seed.ts'
import { getPartnerEligibility, getActiveAssignment, hasPartnerAccepted, isLivePartnerApproved, nextPartnerId, liveServiceAreas, livePresenceState } from '../domain/operations.ts'
import { DEFAULT_SUSPENSION_DAYS, formatSuspensionEnd, isValidSuspensionDays, suspensionDaysLabel, suspensionEnd } from '../domain/suspension.ts'

export interface AppFrame {
  data: OperationsState
  feedback: { id: number; kind: 'success' | 'error' | 'info'; message: string } | null
  sequence: number
}

export type OperationAction =
  | { type: 'delivery.create'; pickup: string; drop: string; pickupLocation?: Delivery['pickupLocation']; dropLocation?: Delivery['dropLocation']; packageSize: Delivery['packageSize']; weight: number; vehicle: Delivery['vehicleRequirement']; scheduledStart: string; scheduledEnd: string; instructions: string; category?: Delivery['category']; itemCount?: number; paymentMode?: Delivery['paymentMode']; earnings?: number | null; customerName?: string; customerPhone?: string; orderValue?: number | null; collectAmount?: number | null }
  | { type: 'delivery.update'; deliveryId: string; pickup: string; drop: string; pickupLocation?: Delivery['pickupLocation']; dropLocation?: Delivery['dropLocation']; packageSize: Delivery['packageSize']; weight: number; vehicle: Delivery['vehicleRequirement']; scheduledStart: string; scheduledEnd: string; instructions: string; category?: Delivery['category']; itemCount?: number; paymentMode?: Delivery['paymentMode']; earnings?: number | null; customerName?: string; customerPhone?: string; orderValue?: number | null; collectAmount?: number | null }
  | { type: 'delivery.assign'; deliveryId: string; partnerId: string }
  | { type: 'delivery.unassign'; deliveryId: string; reason: string }
  | { type: 'delivery.advance'; deliveryId: string }
  | { type: 'delivery.delay'; deliveryId: string; reason: string }
  | { type: 'delivery.clear-delay'; deliveryId: string; reason: string }
  | { type: 'delivery.cancel'; deliveryId: string; reason: string }
  | { type: 'delivery.sync-live'; at: string; deliveries: Array<{ id: string; status: 'delivered' | 'cancelled'; cancellationReason: string | null; completedAt: string | null }> }
  | { type: 'delivery.sync-live-orders'; at: string; orders: LiveOrderSnapshot[] }
  | { type: 'offer.create'; deliveryId: string; partnerId: string }
  | { type: 'offer.send'; offerId: string }
  | { type: 'offer.accept'; offerId: string }
  | { type: 'offer.reject'; offerId: string; reason: string }
  | { type: 'offer.expire'; offerId: string }
  | { type: 'offer.expire-due'; now: number }
  | { type: 'partner.create'; partnerId: string; name: string; phone: string; email: string; vehicle: Partner['vehicle']; serviceAreas: string[]; registrationLast4: string; note: string }
  | { type: 'partner.restrict'; partnerId: string; status: 'Restricted' | 'Suspended'; reason: string; durationDays?: number }
  | { type: 'partner.restore'; partnerId: string; reason: string }
  | { type: 'partner.expire-suspensions'; now: number }
  | { type: 'partner.availability'; partnerId: string; availability: 'Available' | 'Offline'; reason: string }
  | { type: 'document.update'; documentId: string; status: DocumentStatus; reason: string; expiresAt: string | null }
  | { type: 'application.approve'; applicationId: string; note: string }
  | { type: 'application.reject'; applicationId: string; reason: string }
  | { type: 'partnerApp.save'; config: Pick<PartnerAppConfig, 'mode' | 'projectId' | 'apiKey' | 'databaseId' | 'partnersCollection' | 'endpointUrl'> }
  | { type: 'partnerApp.connected'; at: string }
  | { type: 'partnerApp.sync-result'; records: PartnerAppRecord[]; tickets?: PartnerAppTicket[]; documents?: PartnerAppDocument[]; at: string; silent?: boolean }
  | { type: 'partnerApp.ticket-status'; ticketId: string; status: string; at: string }
  | { type: 'partnerApp.document-review'; uid: string; documentKey: string; review: PartnerDocumentReview; at: string }
  | { type: 'partnerApp.failed'; message: string }
  | { type: 'partnerApp.link'; recordId: string; partnerId: string }
  | { type: 'partnerApp.unlink'; partnerId: string }
  | { type: 'partnerApp.review'; recordId: string; decision: 'Approved' | 'Rejected'; note: string }
  | { type: 'partnerApp.write-result'; targetType: 'Application' | 'Partner' | 'Delivery'; targetId: string; recordId: string; ok: boolean; message: string; at: string; applicationStatus: string | null; accountStatus: string | null }
  | { type: 'notification.read'; notificationId: string }
  | { type: 'notification.read-all' }
  | { type: 'settings.save'; settings: OperationsState['settings'] }
  | { type: 'admin.create'; name: string; email: string; title: string; role: AdminRole; sections: AdminSection[]; permissions: Permission[] }
  | { type: 'admin.update'; adminId: string; name: string; title: string; role: AdminRole; sections: AdminSection[]; permissions: Permission[] }
  | { type: 'admin.set-active'; adminId: string; active: boolean; reason: string }
  | { type: 'user.identify'; id: string; name: string; email: string }
  | { type: 'state.hydrate'; state: OperationsState }
  | { type: 'demo.reset' }

const permissionByAction: Partial<Record<OperationAction['type'], Permission>> = {
  'delivery.create': 'delivery-management',
  'delivery.update': 'delivery-management',
  'delivery.assign': 'assignment',
  'delivery.unassign': 'assignment',
  'delivery.advance': 'assignment',
  'delivery.delay': 'delivery-management',
  'delivery.clear-delay': 'delivery-management',
  'delivery.cancel': 'delivery-management',
  'offer.create': 'assignment',
  'offer.send': 'assignment',
  'offer.accept': 'assignment',
  'offer.reject': 'assignment',
  'offer.expire': 'assignment',
  'partner.create': 'partner-management',
  'partner.restrict': 'partner-management',
  'partner.restore': 'partner-management',
  'partner.availability': 'partner-management',
  'document.update': 'document-review',
  'application.approve': 'application-review',
  'application.reject': 'application-review',
  'partnerApp.save': 'settings',
  // Sync status is a background read and must update for every account that
  // can open Partners. Linking is part of partner management.
  'partnerApp.connected': 'read',
  'partnerApp.sync-result': 'read',
  'partnerApp.failed': 'read',
  'partnerApp.link': 'partner-management',
  'partnerApp.unlink': 'partner-management',
  'partnerApp.review': 'application-review',
  'partnerApp.write-result': 'read',
  'partnerApp.ticket-status': 'partner-management',
  'partnerApp.document-review': 'document-review',
  'delivery.sync-live-orders': 'read',
  'notification.read': 'read',
  'notification.read-all': 'read',
  'settings.save': 'settings',
  'admin.create': 'admin',
  'admin.update': 'admin',
  'admin.set-active': 'admin',
  // Local demo data does not touch production records. The Settings screen
  // still hides the reset control from read-only accounts.
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

function findAdmin(data: OperationsState, id: string) {
  const admin = data.admins.find((item) => item.id === id)
  if (!admin) throw new Error(`Administrator ${id} could not be found.`)
  return admin
}

function activeMainAdmins(data: OperationsState) {
  return data.admins.filter((account) => account.active && account.role === 'Main Administrator')
}

function adminAccessSummary(account: Pick<AdminAccount, 'role' | 'sections' | 'permissions'>) {
  if (account.role === 'Main Administrator') return 'Main Administrator · full access'
  const sections = account.sections.length ? account.sections.join(', ') : 'no sections'
  const permissions = account.permissions.filter((permission) => permission !== 'read').join(', ') || 'view only'
  return `Restricted Administrator · ${sections} · ${permissions}`
}

function normalizeLinkName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

/**
 * Seed and real records often share a display name. Linking by an exact,
 * unique normalized name gives the Administrator a useful starting point
 * without guessing when two people have the same name.
 */
function phoneDigits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

function fullPhoneKey(value: string | null | undefined) {
  const digits = phoneDigits(value)
  return digits.length >= 10 ? digits.slice(-10) : ''
}

function syncLinkedPartnerAvailability(data: OperationsState) {
  for (const partner of data.partners) {
    if (!partner.partnerAppUid || partner.availability === 'Restricted' || partner.availability === 'Suspended') continue
    const record = data.partnerAppRecords.find((item) => item.id === partner.partnerAppUid)
    const activeAssignment = getActiveAssignment(data, partner.id)
    // A real assignment is authoritative and keeps the partner busy. When no
    // assignment is active, a stale local On Delivery value must be replaced
    // by the live presence heartbeat instead of blocking every new delivery.
    if (activeAssignment) {
      partner.availability = 'On Delivery'
      continue
    }
    if (!record) continue
    const approved = isLivePartnerApproved(record)
      || data.applications.some((application) => application.partnerAppUid === record.id && application.status === 'Approved')
    if (!approved || record.status?.toLowerCase() === 'paused') {
      partner.availability = 'Offline'
      continue
    }
    const presence = livePresenceState(record)
    const liveAvailability = String(record.fields.availability ?? '').trim().toLowerCase()
    const busy = liveAvailability === 'on delivery' || liveAvailability === 'busy'
    partner.availability = presence === 'online' ? (busy ? 'On Delivery' : 'Available') : 'Offline'
  }
}

function syncLinkedPartnerProfile(data: OperationsState) {
  for (const partner of data.partners) {
    if (!partner.partnerAppUid) continue
    const record = data.partnerAppRecords.find((item) => item.id === partner.partnerAppUid)
    if (!record) continue
    // Fill only values the live record can supply and the admin record is
    // missing. Never overwrite a service area or registration edit made here.
    if (!partner.serviceAreas.length) {
      const liveAreas = liveServiceAreas(record)
      if (liveAreas.length) partner.serviceAreas = liveAreas
    }
    if (partner.maskedRegistration === 'Not provided') {
      const registration = String(
        record.fields.vehicleRegistrationNumber
        ?? record.fields['vehicle.registrationNumber']
        ?? record.fields.registrationNumber
        ?? '',
      ).replace(/\D/g, '')
      if (registration.length >= 4) partner.maskedRegistration = `WB-••-${registration.slice(-4)}`
    }
  }
}

function autoLinkPartnerAppRecords(data: OperationsState) {
  const recordsByName = new Map<string, PartnerAppRecord[]>()
  const recordsByPhone = new Map<string, PartnerAppRecord[]>()
  for (const record of data.partnerAppRecords) {
    const nameKey = normalizeLinkName(record.name)
    if (nameKey) recordsByName.set(nameKey, [...(recordsByName.get(nameKey) ?? []), record])
    const phoneKey = fullPhoneKey(record.phone)
    if (phoneKey) recordsByPhone.set(phoneKey, [...(recordsByPhone.get(phoneKey) ?? []), record])
  }

  for (const partner of data.partners) {
    if (partner.partnerAppUid) continue
    const candidates = recordsByName.get(normalizeLinkName(partner.name)) ?? []
    if (candidates.length === 1) partner.partnerAppUid = candidates[0].id
  }

  // Demo partner numbers link the local sample record to the live partner app
  // document so an admin decision can be demonstrated end to end.
  for (const partner of data.partners) {
    if (partner.partnerAppUid || !partner.demoPhone) continue
    const candidates = recordsByPhone.get(fullPhoneKey(partner.demoPhone)) ?? []
    if (candidates.length === 1) partner.partnerAppUid = candidates[0].id
  }

  for (const application of data.applications) {
    if (application.partnerAppUid) continue
    if (application.partnerId) {
      const partner = data.partners.find((item) => item.id === application.partnerId)
      if (partner?.partnerAppUid) {
        application.partnerAppUid = partner.partnerAppUid
        continue
      }
    }
    const candidates = recordsByName.get(normalizeLinkName(application.applicantName)) ?? []
    if (candidates.length === 1) application.partnerAppUid = candidates[0].id
  }
}

/**
 * Creates local directory records for already-approved delivery_app accounts.
 * Without this, a fresh console has live partner records but an empty All
 * Partners directory and no assignable rider records.
 */
function importApprovedPartnerAppRecords(data: OperationsState, at: string) {
  let changed = 0
  for (const record of data.partnerAppRecords) {
    const approved = isLivePartnerApproved(record)
    if (!approved) continue
    if (data.partners.some((partner) => partner.partnerAppUid === record.id)) continue

    const nameKey = normalizeLinkName(record.name)
    const unlinkedMatches = nameKey
      ? data.partners.filter((partner) => !partner.partnerAppUid && normalizeLinkName(partner.name) === nameKey)
      : []
    if (unlinkedMatches.length === 1) {
      unlinkedMatches[0].partnerAppUid = record.id
      changed += 1
      continue
    }

    const partnerId = nextPartnerId(data)
    const registration = String(
      record.fields.vehicleRegistrationNumber
      ?? record.fields['vehicle.registrationNumber']
      ?? record.fields.registrationNumber
      ?? '',
    ).replace(/\D/g, '')
    const online = record.isOnline === true
      || record.status?.trim().toLowerCase() === 'online'
      || record.status?.trim().toLowerCase() === 'available'
    const partner: Partner = {
      id: partnerId,
      name: record.name,
      maskedPhone: maskPhoneNumber(record.phone),
      demoPhone: null,
      maskedEmail: maskEmailAddress(record.email),
      registeredAt: record.updatedAt ?? at,
      vehicle: adminVehicleFor(record.vehicle),
      maskedRegistration: registration.length >= 4 ? `WB-••-${registration.slice(-4)}` : 'Not provided',
      serviceAreas: liveServiceAreas(record),
      availability: online ? 'Available' : 'Offline',
      restrictedReason: null,
      suspendedReason: null,
      suspendedUntil: null,
      suspensionDays: null,
      needsOperationalReview: false,
      partnerAppUid: record.id,
      source: 'delivery_app',
    }
    data.partners.unshift(partner)
    partnerHistory(data, partnerId, 'Imported from delivery_app', `Approved delivery_app account ${record.id} added to the admin partner directory.`, null, at)
    audit(data, 'Partner created', 'Partner', partnerId, 'Not in the directory', `${partnerId} · ${partner.name} · delivery_app`, 'Imported from an approved delivery_app account.', at)
    changed += 1
  }
  return changed
}

const LIVE_MILESTONE_BY_STATUS: Record<string, DeliveryMilestoneName> = {
  accepted: 'Accepted',
  pickup_arrived: 'Pickup Arrived',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  drop_arrived: 'Drop Arrived',
  delivered: 'Delivered',
}

function liveMilestones(order: LiveOrderSnapshot): Delivery['milestones'] {
  return DELIVERY_MILESTONES.map((name) => {
    const event = [...order.events]
      .filter((item) => LIVE_MILESTONE_BY_STATUS[item.status] === name)
      .sort((left, right) => right.at.localeCompare(left.at))[0]
    return {
      name,
      completedAt: event?.at ?? null,
      completedBy: event ? 'Partner app' : null,
    }
  })
}

function localStatusFromLive(order: LiveOrderSnapshot): DeliveryStatus {
  if (order.nativeStatus === 'delivered') return 'Completed'
  if (order.nativeStatus === 'cancelled') return 'Cancelled'
  if (['picked_up', 'in_transit', 'drop_arrived'].includes(order.nativeStatus)) return 'In Transit'
  if (['accepted', 'pickup_arrived'].includes(order.nativeStatus)) return 'Assigned'
  return order.partnerUid ? 'Assigned' : 'Unassigned'
}

/**
 * Reconciles every live order into the shared local queue. New delivery_app
 * orders become visible in Deliveries/Overview, and acceptance, rejection and
 * in-progress milestones stay in step instead of waiting for completion.
 */
function syncLiveOrders(data: OperationsState, orders: LiveOrderSnapshot[], at: string): number {
  let changed = importApprovedPartnerAppRecords(data, at)
  for (const order of orders) {
    const livePartner = order.partnerUid
      ? data.partners.find((partner) => partner.partnerAppUid === order.partnerUid)
      : undefined
    let delivery = data.deliveries.find((item) => item.id === order.id)
    // A local assignment, removal, or cancellation that has not reached
    // delivery_app yet is authoritative until its write succeeds. A stale poll
    // must not restore the previous offer or hide the Retry publish failure.
    if (delivery && (delivery.publicationStatus === 'Pending' || delivery.publicationStatus === 'Failed')) {
      continue
    }
    let previousLiveStatus: string | null | undefined = null
    let previousStatus: DeliveryStatus | null = delivery?.status ?? null
    const isNew = !delivery
    const requestedAt = order.requestedAt ?? order.acceptedAt ?? at
    const milestones = liveMilestones(order)
    // A withdrawn offer is written as a cancelled document with no partner.
    // That must not cancel the delivery itself: it is waiting for reassignment.
    const withdrawn = order.withdrawn
      && delivery?.status !== 'Completed'
      && delivery?.status !== 'Cancelled'
    const nextStatus: DeliveryStatus = withdrawn ? 'Unassigned' : localStatusFromLive(order)
    let localChanged = false

    if (!delivery) {
      delivery = {
        id: order.id,
        pickup: order.pickup.name || 'Pickup',
        drop: order.destination.name || 'Drop',
        pickupAddress: order.pickup.address || order.pickup.name,
        dropAddress: order.destination.address || order.destination.name,
        pickupLocation: { latitude: order.pickup.latitude, longitude: order.pickup.longitude },
        dropLocation: { latitude: order.destination.latitude, longitude: order.destination.longitude },
        packageSize: 'Small',
        estimatedWeightKg: 0,
        vehicleRequirement: 'Any',
        scheduledStart: requestedAt,
        scheduledEnd: new Date(new Date(requestedAt).getTime() + Math.max(8, order.etaMinutes) * 60_000).toISOString(),
        specialInstructions: order.note || 'No special instructions',
        createdAt: requestedAt,
        status: nextStatus,
        statusBeforeDelay: null,
        delayReason: null,
        assignmentId: null,
        milestones,
        category: order.category,
        itemCount: order.itemCount,
        paymentMode: order.paymentMode,
        partnerEarnings: order.earnings,
        liveStatus: order.rejected ? 'rejected' : order.nativeStatus,
        publicationStatus: 'Published',
        publishError: null,
      }
      data.deliveries.unshift(delivery)
      localChanged = true
      if (!['delivered', 'cancelled'].includes(order.nativeStatus)) {
        audit(data, 'Delivery created', 'Delivery', delivery.id, 'Not in the console', `${order.displayId} · delivery_app`, 'Imported from delivery_app.', at)
      }
      if (!order.rejected && ['assigned', 'accepted'].includes(order.nativeStatus)
        && new Date(requestedAt).getTime() > Date.now() - 15 * 60_000) {
        notify(data, 'Delivery Assigned', 'New live delivery order', `${order.displayId} · ${delivery.pickup} → ${delivery.drop}${livePartner ? ` · ${livePartner.name}` : ''}.`, `/admin/deliveries/${delivery.id}`, delivery.id, at)
      }
    } else {
      previousStatus = delivery.status
      previousLiveStatus = delivery.liveStatus
      const shouldKeepDelay = delivery.status === 'Delayed'
        && (order.withdrawn || !['delivered', 'cancelled'].includes(order.nativeStatus))
      delivery.liveStatus = order.rejected ? 'rejected' : order.nativeStatus
      delivery.publicationStatus = 'Published'
      delivery.publishError = null
      if (!shouldKeepDelay && delivery.status !== nextStatus) {
        delivery.status = nextStatus
        localChanged = true
        if (!isNew) {
          audit(data, 'Delivery status changed', 'Delivery', delivery.id, previousStatus, nextStatus, 'Reconciled from delivery_app status.', at)
        }
      }
      if (JSON.stringify(delivery.milestones) !== JSON.stringify(milestones)) {
        delivery.milestones = milestones
        localChanged = true
      }
      if (order.pickup.name && delivery.pickup !== order.pickup.name) {
        delivery.pickup = order.pickup.name
        localChanged = true
      }
      if (order.destination.name && delivery.drop !== order.destination.name) {
        delivery.drop = order.destination.name
        localChanged = true
      }
      if (order.pickup.address && delivery.pickupAddress !== order.pickup.address) {
        delivery.pickupAddress = order.pickup.address
        localChanged = true
      }
      if (order.destination.address && delivery.dropAddress !== order.destination.address) {
        delivery.dropAddress = order.destination.address
        localChanged = true
      }
      delivery.pickupLocation = { latitude: order.pickup.latitude, longitude: order.pickup.longitude }
      delivery.dropLocation = { latitude: order.destination.latitude, longitude: order.destination.longitude }
      if (order.category && delivery.category !== order.category) {
        delivery.category = order.category
        localChanged = true
      }
      if (order.itemCount && delivery.itemCount !== order.itemCount) {
        delivery.itemCount = order.itemCount
        localChanged = true
      }
      if (order.paymentMode && delivery.paymentMode !== order.paymentMode) {
        delivery.paymentMode = order.paymentMode
        localChanged = true
      }
      if (order.earnings && delivery.partnerEarnings !== order.earnings) {
        delivery.partnerEarnings = order.earnings
        localChanged = true
      }
    }

    const activeAssignment = delivery.assignmentId
      ? data.assignments.find((item) => item.id === delivery.assignmentId && item.status === 'Active')
      : undefined

    if (order.rejected) {
      if (activeAssignment) {
        releaseAssignment(data, activeAssignment.id, 'Declined by the partner in delivery_app', at)
        delivery.assignmentId = null
        localChanged = true
      }
      if (delivery.status !== 'Unassigned') {
        delivery.status = 'Unassigned'
        localChanged = true
      }
      if (previousLiveStatus !== 'rejected') {
        audit(data, 'Delivery status changed', 'Delivery', delivery.id, previousStatus ?? 'Assigned', 'Unassigned', 'Declined by the partner in delivery_app.', at)
        notify(data, 'Partner Rejected Offer', 'Partner declined the delivery', `${order.displayId} was declined${livePartner ? ` by ${livePartner.name}` : ''}. Reassign the order.`, `/admin/deliveries/${delivery.id}`, delivery.id, at)
      }
    } else if (order.nativeStatus === 'delivered') {
      if (activeAssignment) {
        releaseAssignment(data, activeAssignment.id, 'Delivery completed by the partner app', at, 'Completed')
        localChanged = true
      }
      if (delivery.status !== 'Completed') {
        delivery.status = 'Completed'
        localChanged = true
      }
      if (delivery.milestones.some((milestone) => !milestone.completedAt)) {
        delivery.milestones = milestones.every((milestone) => milestone.completedAt) ? milestones : delivery.milestones.map((milestone) => ({ ...milestone, completedAt: milestone.completedAt ?? order.completedAt ?? at, completedBy: milestone.completedBy ?? 'Partner app' }))
        localChanged = true
      }
    } else if (withdrawn) {
      // The document is a withdrawal tombstone, not a customer cancellation.
      // Keep the delivery assignable and clear any assignment a stale poll
      // recreated before the withdrawal write landed.
      if (activeAssignment) {
        releaseAssignment(data, activeAssignment.id, 'Offer withdrawn by the administrator', at)
        delivery.assignmentId = null
        localChanged = true
      }
      if (delivery.status !== 'Delayed' && delivery.status !== nextStatus) {
        delivery.status = nextStatus
        localChanged = true
      }
    } else if (order.nativeStatus === 'cancelled') {
      if (activeAssignment) {
        releaseAssignment(data, activeAssignment.id, `Cancelled in delivery_app${order.cancellationReason ? `: ${order.cancellationReason}` : ''}`, at)
        localChanged = true
      }
      if (delivery.status !== 'Cancelled') {
        delivery.status = 'Cancelled'
        localChanged = true
      }
    } else if (livePartner) {
      if (!activeAssignment) {
        const assignment: Assignment = {
          id: uid('ASN'),
          deliveryId: delivery.id,
          partnerId: livePartner.id,
          assignedAt: order.acceptedAt ?? requestedAt,
          assignedBy: 'delivery_app',
          status: 'Active',
          releasedAt: null,
          releaseReason: null,
          attempt: data.assignments.filter((item) => item.deliveryId === delivery.id).length + 1,
          dropOtp: order.dropOtp,
        }
        data.assignments.unshift(assignment)
        delivery.assignmentId = assignment.id
        localChanged = true
      } else if (activeAssignment.partnerId !== livePartner.id) {
        releaseAssignment(data, activeAssignment.id, 'Partner changed in delivery_app', at)
        const assignment: Assignment = {
          id: uid('ASN'),
          deliveryId: delivery.id,
          partnerId: livePartner.id,
          assignedAt: order.acceptedAt ?? at,
          assignedBy: 'delivery_app',
          status: 'Active',
          releasedAt: null,
          releaseReason: null,
          attempt: data.assignments.filter((item) => item.deliveryId === delivery.id).length + 1,
          dropOtp: order.dropOtp,
        }
        data.assignments.unshift(assignment)
        delivery.assignmentId = assignment.id
        localChanged = true
      }
      if (livePartner.availability !== 'Suspended' && livePartner.availability !== 'Restricted' && livePartner.availability !== 'On Delivery') {
        livePartner.availability = 'On Delivery'
        localChanged = true
      }
    }

    if (localChanged) changed += 1
  }
  if (changed) syncLinkedPartnerAvailability(data)
  return changed
}

function nextApplicationId(data: OperationsState) {
  const numbers = data.applications.map((item) => Number(item.id.replace(/\D/g, ''))).filter(Number.isFinite)
  return `APP-${Math.max(2_040, ...numbers) + 1}`
}

function maskPhoneNumber(phone: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `+91 ••••• ${digits.slice(-4)}` : 'Not provided'
}

function maskEmailAddress(email: string | null) {
  const value = (email ?? '').trim()
  const [local, domain] = value.split('@')
  return local && domain ? `${local.slice(0, 4)}••@${domain}` : 'Not provided'
}

function adminVehicleFor(value: string | null): Partner['vehicle'] {
  const normalized = (value ?? '').toLowerCase()
  if (normalized.includes('van')) return 'Van'
  if (normalized.includes('scooter')) return 'Scooter'
  if (normalized.includes('bicycle') || normalized.includes('cycle')) return 'Bicycle'
  if (normalized.includes('foot') || normalized.includes('walk')) return 'On foot'
  return 'Bike'
}

/**
 * A delivery_app account can submit onboarding before the Administrator has a
 * local application record. Building one from the synced record lets the
 * Administrator approve or reject it and keeps both apps in step.
 */
function applicationFromPartnerRecord(data: OperationsState, record: PartnerAppRecord): PartnerApplication {
  if (!record.name.trim() || record.name === record.id) {
    throw new Error('This delivery_app account has not completed onboarding, so there is no application to review.')
  }
  const serviceAreas = liveServiceAreas(record)
  return {
    id: nextApplicationId(data),
    applicantName: record.name,
    businessName: `${record.name} · delivery_app`,
    maskedPhone: maskPhoneNumber(record.phone),
    maskedEmail: maskEmailAddress(record.email),
    vehicle: adminVehicleFor(record.vehicle),
    serviceAreas: serviceAreas.length ? serviceAreas : ['Kolkata'],
    submittedAt: record.updatedAt ?? record.syncedAt,
    // Document files remain in delivery_app; do not claim every required file
    // is attached when the admin sync has not imported document metadata.
    documents: [],
    status: 'Submitted',
    reviewedBy: null,
    reviewedAt: null,
    decisionReason: null,
    partnerId: null,
    partnerAppUid: record.id,
    demoRecord: false,
  }
}

function approveApplication(data: OperationsState, application: PartnerApplication, note: string, at: string, existingPartnerId: string | null = null) {
  if (application.status !== 'Submitted') throw new Error(`${application.id} has already been decided and cannot be reviewed again.`)
  let partner: Partner
  let partnerId: string
  if (existingPartnerId) {
    // A manually linked directory record already represents this person. Keep
    // it instead of adding a duplicate partner on approval.
    partner = findPartner(data, existingPartnerId)
    partnerId = partner.id
    partner.partnerAppUid = application.partnerAppUid
  } else {
    partnerId = nextPartnerId(data)
    partner = {
      id: partnerId,
      name: application.applicantName,
      maskedPhone: application.maskedPhone,
      demoPhone: null,
      maskedEmail: application.maskedEmail,
      registeredAt: at,
      vehicle: application.vehicle,
      maskedRegistration: `WB-••-${String(2300 + data.partners.length).slice(-4)}`,
      serviceAreas: [...application.serviceAreas],
      availability: 'Offline',
      restrictedReason: null,
      suspendedReason: null,
      suspendedUntil: null,
      suspensionDays: null,
      needsOperationalReview: false,
      partnerAppUid: application.partnerAppUid,
    }
    data.partners.unshift(partner)
  }
  // Live delivery_app applications keep their document source of truth in
  // Firebase. Do not manufacture local document rows for them; incomplete
  // documents must not block assignment after admin approval.
  if (!application.partnerAppUid) {
    const submittedTypes = new Set(application.documents)
    if (!data.documents.some((document) => document.partnerId === partnerId)) {
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
    }
  }
  const previous = application.status
  application.status = 'Approved'
  application.reviewedBy = data.user.name
  application.reviewedAt = at
  application.decisionReason = note.trim() || null
  application.partnerId = partnerId
  partnerHistory(data, partnerId, 'Application approved', `Onboarding application ${application.id} approved. ${partner.name} is available for delivery operations.`, null, at)
  audit(data, 'Application approved', 'Application', application.id, previous, `Approved · ${partnerId}`, note || 'Approved by Administrator.', at)
  notify(data, 'Partner Application Approved', 'Onboarding application approved', `${application.applicantName} · ${application.businessName} was approved and added as ${partnerId}.`, `/admin/partners/${partnerId}`, application.id, at)

  return { partnerId, message: `${application.id} approved. ${partner.name} added as ${partnerId} and can receive delivery assignments.` }
}

function rejectApplication(data: OperationsState, application: PartnerApplication, reason: string, at: string) {
  requireValue(reason, 'Rejection reason')
  if (application.status !== 'Submitted') throw new Error(`${application.id} has already been decided and cannot be reviewed again.`)
  const previous = application.status
  application.status = 'Rejected'
  application.reviewedBy = data.user.name
  application.reviewedAt = at
  application.decisionReason = reason.trim()
  audit(data, 'Application rejected', 'Application', application.id, previous, 'Rejected', reason, at)
  notify(data, 'Partner Application Rejected', 'Onboarding application rejected', `${application.applicantName} · ${application.businessName}: ${reason.trim()}`, '/admin/kyc', application.id, at)
  return { message: `${application.id} rejected with a recorded reason.` }
}

function audit(data: OperationsState, eventType: AuditEventType, targetType: AuditLogEntry['targetType'], targetId: string, previousValue: string, newValue: string, reason: string, at: string) {
  data.auditLogs.push({
    id: uid('EVT'), eventType, operator: data.user.name, operatorRole: data.user.role,
    targetType, targetId, previousValue, newValue, timestamp: at, reason: reason.trim() || 'No additional note',
  })
}

function notify(data: OperationsState, category: NotificationCategory, title: string, message: string, path: string, recordId: string, at: string) {
  if (data.settings.notifications[category] === false) return
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

/**
 * Mirrors terminal partner-app lifecycle events onto the local records. The
 * console's assignment records are otherwise frozen: a partner who completes a
 * delivery in their app stayed "On Delivery" here forever and was refused by
 * every future assignment. Returns the number of records changed.
 */
function syncLiveDeliveries(
  data: OperationsState,
  deliveries: Array<{ id: string; status: 'delivered' | 'cancelled'; cancellationReason: string | null; completedAt: string | null }>,
  at: string,
): number {
  let changed = 0

  for (const live of deliveries) {
    const delivery = data.deliveries.find((item) => item.id === live.id)
    if (!delivery) continue
    if (delivery.status === 'Completed' || delivery.status === 'Cancelled') continue

    const assignment = delivery.assignmentId
      ? data.assignments.find((item) => item.id === delivery.assignmentId)
      : undefined

    const previous = delivery.status
    const completedAt = live.completedAt ?? at

    if (live.status === 'delivered') {
      delivery.status = 'Completed'
      delivery.statusBeforeDelay = null
      delivery.delayReason = null
      for (const milestone of delivery.milestones) {
        if (!milestone.completedAt) {
          milestone.completedAt = completedAt
          milestone.completedBy = 'Partner app'
        }
      }
      if (assignment?.status === 'Active') {
        releaseAssignment(data, assignment.id, 'Delivery completed by the partner app', at, 'Completed')
      }
      notify(data, 'Delivery Completed', 'Delivery completed by the partner', `${delivery.id} was completed in the partner app.`, `/admin/deliveries/${delivery.id}`, delivery.id, at)
    } else {
      delivery.status = 'Cancelled'
      delivery.statusBeforeDelay = null
      delivery.delayReason = null
      if (assignment?.status === 'Active') {
        releaseAssignment(data, assignment.id, `Cancelled in the partner app${live.cancellationReason ? `: ${live.cancellationReason}` : ''}`, at)
      }
    }

    audit(
      data,
      'Delivery status changed',
      'Delivery',
      delivery.id,
      previous,
      delivery.status,
      `Synced from the partner app live record.${live.cancellationReason ? ` Reason: ${live.cancellationReason}` : ''}`,
      at,
    )
    changed += 1
  }

  return changed
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
    note: sendNow ? 'Sent locally; awaiting partner response.' : null,
    stateHistory: sentStates,
  }
  data.offers.unshift(offer)
  return offer
}

function assignPartner(data: OperationsState, deliveryId: string, partnerId: string, at: string, reason = 'Manual assignment') {
  const delivery = findDelivery(data, deliveryId)
  const partner = findPartner(data, partnerId)
  if (delivery.status === 'Completed') throw new Error('Completed deliveries cannot be reassigned.')
  if (delivery.status === 'Cancelled') throw new Error('Cancelled deliveries cannot be assigned.')
  const previous = data.assignments.find((assignment) => assignment.deliveryId === deliveryId && assignment.status === 'Active')
  if (previous?.partnerId === partnerId) throw new Error(`${partner.name} is already assigned to ${delivery.id}.`)
  if (previous && (delivery.status === 'In Transit'
    || (delivery.liveStatus && !['assigned', 'rejected', 'cancelled'].includes(delivery.liveStatus)))) {
    throw new Error('This partner has already accepted or started the delivery. Reassignment is blocked after acceptance.')
  }
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
    dropOtp: createDropOtp(),
  }
  data.assignments.unshift(assignment)
  delivery.assignmentId = assignment.id
  if (delivery.status !== 'Delayed') {
    if (!delivery.milestones[0]?.completedAt) {
      delivery.milestones[0] = { name: DELIVERY_MILESTONES[0], completedAt: at, completedBy: partner.name }
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
    notify(data, 'Unassigned Delivery', 'Maximum offer attempts reached', `${deliveryId} remains in the dispatch queue after ${attempts.length} offer attempts.`, `/admin/deliveries/${deliveryId}`, deliveryId, at)
    return
  }
  const alreadyOffered = new Set(attempts.map((offer) => offer.partnerId))
  const candidate = data.partners.find((partner) => !alreadyOffered.has(partner.id) && getPartnerEligibility(data, partner, delivery, new Date(at).getTime()).eligible)
  if (candidate) {
    const offer = makeOffer(data, deliveryId, candidate.id, at, true)
    offer.note = 'Automatic next-eligible fallback offer · policy enabled.'
    audit(data, 'Assignment offer created', 'Offer', offer.id, 'No active offer', `${candidate.id} · attempt ${offer.attempt}`, 'Fallback explicitly enabled in settings.', at)
  } else {
    notify(data, 'Unassigned Delivery', 'No eligible fallback partner', `${deliveryId} remains unassigned; no additional partner passed eligibility checks.`, `/admin/deliveries/${deliveryId}/assign`, deliveryId, at)
  }
}

function timeoutOffer(data: OperationsState, offerId: string, at: string) {
  const offer = findOffer(data, offerId)
  if (offer.status !== 'Awaiting Response') throw new Error('Only offers awaiting a response can time out.')
  offer.status = 'Timed Out'
  offer.respondedAt = at
  offer.note = 'Timed out in the offer lifecycle.'
  offer.stateHistory.push({ status: 'Timed Out', at })
  audit(data, 'Assignment offer timed out', 'Offer', offer.id, 'Awaiting Response', 'Timed Out', 'Offer deadline elapsed.', at)
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
      if (action.earnings != null && (!Number.isFinite(action.earnings) || action.earnings < 0)) throw new Error('Partner payout must be a positive amount.')
      if (action.itemCount != null && (!Number.isInteger(action.itemCount) || action.itemCount < 1 || action.itemCount > 99)) throw new Error('Item count must be between 1 and 99.')
      const customerPhone = (action.customerPhone ?? '').replace(/\D/g, '')
      if (customerPhone && customerPhone.length < 10) throw new Error('Customer phone must have at least 10 digits.')
      if (action.orderValue != null && (!Number.isFinite(action.orderValue) || action.orderValue < 0)) throw new Error('Order value must be a positive amount.')
      if (action.collectAmount != null && (!Number.isFinite(action.collectAmount) || action.collectAmount < 0)) throw new Error('COD amount must be a positive amount.')
      const numbers = data.deliveries.map((item) => Number(item.id.replace(/\D/g, ''))).filter(Number.isFinite)
      const id = `DLV-${Math.max(1048, ...numbers) + 1}`
      const starts = new Date(action.scheduledStart)
      const ends = new Date(action.scheduledEnd)
      if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) throw new Error('Choose a valid delivery window.')
      const delivery: Delivery = {
        id, pickup: action.pickup.trim(), drop: action.drop.trim(),
        pickupAddress: `Pickup point · ${action.pickup.trim()}`,
        dropAddress: `Drop point · ${action.drop.trim()}`,
        pickupLocation: action.pickupLocation,
        dropLocation: action.dropLocation,
        packageSize: action.packageSize, estimatedWeightKg: action.weight,
        vehicleRequirement: action.vehicle, scheduledStart: starts.toISOString(), scheduledEnd: ends.toISOString(),
        specialInstructions: action.instructions.trim() || 'No special instructions',
        createdAt: at, status: 'Unassigned', statusBeforeDelay: null, delayReason: null, assignmentId: null,
        milestones: DELIVERY_MILESTONES.map((name) => ({ name, completedAt: null, completedBy: null })),
        category: action.category ?? 'Grocery',
        itemCount: action.itemCount ?? 1,
        paymentMode: action.paymentMode ?? 'Prepaid',
        partnerEarnings: action.earnings ?? null,
        customerName: action.customerName?.trim() || undefined,
        customerPhone: customerPhone || undefined,
        orderValue: action.orderValue ?? null,
        collectAmount:
          action.collectAmount ??
          (action.paymentMode === 'Cash on delivery'
            ? action.orderValue ?? null
            : null),
      }
      data.deliveries.unshift(delivery)
      audit(data, 'Delivery created', 'Delivery', id, '—', 'Unassigned', 'Created as a local delivery record.', at)
      notify(data, 'Unassigned Delivery', 'New unassigned delivery', `${id} is waiting for an eligible delivery partner.`, `/admin/deliveries/${id}/assign`, id, at)
      return { message: `${id} created in local data.` }
    }
    case 'delivery.update': {
      const delivery = findDelivery(data, action.deliveryId)
      if (delivery.status === 'Completed' || delivery.status === 'Cancelled') {
        throw new Error('Completed or cancelled deliveries cannot be edited.')
      }
      const activeAssignment = delivery.assignmentId
        ? data.assignments.find((item) => item.id === delivery.assignmentId && item.status === 'Active')
        : undefined
      const assignedPartner = activeAssignment
        ? data.partners.find((partner) => partner.id === activeAssignment.partnerId)
        : undefined
      const partnerAccepted = Boolean(
        (activeAssignment && hasPartnerAccepted(delivery, undefined, true))
        || (delivery.liveStatus && !['assigned', 'rejected', 'cancelled'].includes(delivery.liveStatus))
        || delivery.status === 'In Transit',
      )
      if (partnerAccepted) {
        throw new Error('The partner has accepted or started this delivery. Delivery details are locked after acceptance.')
      }
      if (activeAssignment && delivery.publicationStatus === 'Pending') {
        throw new Error('This delivery is still publishing to delivery_app. Wait for the publish to finish or retry before editing.')
      }
      if (activeAssignment && delivery.publicationStatus === 'Failed') {
        throw new Error('The last delivery_app update failed. Retry publishing or remove the partner before editing.')
      }

      requireValue(action.pickup, 'Pickup area')
      requireValue(action.drop, 'Drop area')
      if (action.pickup.trim().toLowerCase() === action.drop.trim().toLowerCase()) throw new Error('Pickup and drop areas must be different.')
      if (!Number.isFinite(action.weight) || action.weight <= 0 || action.weight > 100) throw new Error('Estimated weight must be between 0.1 and 100 kg.')
      if (action.earnings != null && (!Number.isFinite(action.earnings) || action.earnings < 0)) throw new Error('Partner payout must be a positive amount.')
      if (action.itemCount != null && (!Number.isInteger(action.itemCount) || action.itemCount < 1 || action.itemCount > 99)) throw new Error('Item count must be between 1 and 99.')
      const customerPhone = (action.customerPhone ?? '').replace(/\D/g, '')
      if (customerPhone && customerPhone.length < 10) throw new Error('Customer phone must have at least 10 digits.')
      if (action.orderValue != null && (!Number.isFinite(action.orderValue) || action.orderValue < 0)) throw new Error('Order value must be a positive amount.')
      if (action.collectAmount != null && (!Number.isFinite(action.collectAmount) || action.collectAmount < 0)) throw new Error('COD amount must be a positive amount.')
      const starts = new Date(action.scheduledStart)
      const ends = new Date(action.scheduledEnd)
      if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) throw new Error('Choose a valid delivery window.')

      const previous = `${delivery.pickup} → ${delivery.drop} · ${delivery.packageSize} · ${delivery.scheduledStart}`
      const pickup = action.pickup.trim()
      const drop = action.drop.trim()
      const pickupChanged = delivery.pickup !== pickup
      const dropChanged = delivery.drop !== drop
      delivery.pickup = pickup
      delivery.drop = drop
      if (pickupChanged) delivery.pickupAddress = pickup
      if (dropChanged) delivery.dropAddress = drop
      delivery.pickupLocation = action.pickupLocation ?? delivery.pickupLocation
      delivery.dropLocation = action.dropLocation ?? delivery.dropLocation
      delivery.packageSize = action.packageSize
      delivery.estimatedWeightKg = action.weight
      delivery.vehicleRequirement = action.vehicle
      delivery.scheduledStart = starts.toISOString()
      delivery.scheduledEnd = ends.toISOString()
      delivery.specialInstructions = action.instructions.trim() || 'No special instructions'
      delivery.category = action.category ?? 'Grocery'
      delivery.itemCount = action.itemCount ?? 1
      delivery.paymentMode = action.paymentMode ?? 'Prepaid'
      delivery.partnerEarnings = action.earnings ?? null
      delivery.customerName = action.customerName?.trim() || undefined
      delivery.customerPhone = customerPhone || undefined
      delivery.orderValue = action.orderValue ?? null
      delivery.collectAmount =
        action.collectAmount ??
        (action.paymentMode === 'Cash on delivery' ? action.orderValue ?? null : null)

      if (activeAssignment && assignedPartner?.partnerAppUid) {
        // The audit entry below triggers a targeted Firestore update; keep the
        // delivery visibly pending until that write succeeds.
        delivery.publicationStatus = 'Pending'
        delivery.publishError = null
      }
      const next = `${delivery.pickup} → ${delivery.drop} · ${delivery.packageSize} · ${delivery.scheduledStart}`
      audit(data, 'Delivery updated', 'Delivery', delivery.id, previous, next, 'Delivery details updated from the admin console.', at)
      if (assignedPartner) {
        partnerHistory(data, assignedPartner.id, 'Delivery updated', `${delivery.id} details updated by ${data.user.name}.`, delivery.id, at)
      }
      return { message: `${delivery.id} updated.` }
    }
    case 'delivery.assign': {
      const delivery = findDelivery(data, action.deliveryId)
      const partner = findPartner(data, action.partnerId)
      assignPartner(data, delivery.id, partner.id, at)
      delivery.liveStatus = 'assigned'
      delivery.publicationStatus = partner.partnerAppUid ? 'Pending' : 'Not linked'
      delivery.publishError = null
      // An unlinked partner has no delivery_app Firestore record, so the
      // write-through cannot publish an offer and the partner will never see
      // this assignment. Say so instead of reporting a silent success.
      return {
        message: partner.partnerAppUid
          ? `${partner.name} assigned to ${delivery.id}.`
          : `${partner.name} assigned to ${delivery.id}, but this partner is not linked to a partner app account — no offer was sent. Link them under Partners → Partner app first.`,
        kind: partner.partnerAppUid ? 'success' : 'info',
      }
    }
    case 'delivery.unassign': {
      const delivery = findDelivery(data, action.deliveryId)
      const assignment = delivery.assignmentId ? data.assignments.find((item) => item.id === delivery.assignmentId && item.status === 'Active') : undefined
      if (!assignment) throw new Error('This delivery has no active partner assignment.')
      if (delivery.status !== 'Assigned') throw new Error('This partner has accepted or started the delivery and cannot be removed.')
      const partner = findPartner(data, assignment.partnerId)
      releaseAssignment(data, assignment.id, action.reason.trim() || 'Removed by administrator', at)
      delivery.assignmentId = null
      delivery.status = 'Unassigned'
      delivery.milestones = delivery.milestones.map((milestone) => ({ ...milestone, completedAt: null, completedBy: null }))
      delivery.liveStatus = 'cancelled'
      delivery.publicationStatus = partner.partnerAppUid ? 'Pending' : 'Not linked'
      audit(data, 'Delivery unassigned', 'Delivery', delivery.id, partner.id, 'Unassigned', action.reason, at)
      notify(data, 'Unassigned Delivery', 'Partner removed from delivery', `${partner.name} was removed from ${delivery.id} before acceptance.`, `/admin/deliveries/${delivery.id}/assign`, delivery.id, at)
      return { message: `${partner.name} was removed from ${delivery.id}.` }
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
      delivery.milestones[index] = { ...delivery.milestones[index], completedAt: at, completedBy: index === 5 ? data.user.name : findPartner(data, activeAssignment.partnerId).name }
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
    case 'delivery.sync-live': {
      // Terminal partner-app events are reconciled by the dedicated
      // appReducer branch, which stays silent when nothing changed.
      return { message: 'No delivery changes to sync.', kind: 'info' }
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
      audit(data, 'Assignment offer created', 'Offer', offer.id, 'No offer', `Created · ${partner.id}`, 'Created in the offer lifecycle.', at)
      return { message: `Offer ${offer.id} created. Send it to begin the response window.` }
    }
    case 'offer.send': {
      const offer = findOffer(data, action.offerId)
      if (offer.status !== 'Created' && offer.status !== 'Sent') throw new Error('Only a newly created offer can be sent.')
      offer.status = 'Awaiting Response'
      offer.expiresAt = new Date(new Date(at).getTime() + data.settings.offerTimeoutMinutes * 60_000).toISOString()
      offer.note = 'Sent locally; awaiting partner response.'
      offer.stateHistory.push({ status: 'Sent', at }, { status: 'Awaiting Response', at })
      return { message: `${offer.id} sent; awaiting response.` }
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
      return { message: `${partner.name} accepted the offer and was assigned.` }
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
    case 'partner.create': {
      const name = action.name.trim().replace(/\s+/g, ' ')
      requireValue(name, 'Partner name')
      if (name.length > 80) throw new Error('Partner name must be 80 characters or fewer.')
      const phoneDigits = action.phone.replace(/\D/g, '')
      if (phoneDigits.length < 7 || phoneDigits.length > 15) throw new Error('Enter a phone number with 7 to 15 digits.')
      const email = action.email.trim()
      if (email.length > 120) throw new Error('Email address must be 120 characters or fewer.')
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address or leave it blank.')
      if (!['Bike', 'Scooter', 'Van', 'Bicycle', 'On foot'].includes(action.vehicle)) throw new Error('Choose a valid vehicle type.')
      const serviceAreas = [...new Set(action.serviceAreas.map((area) => area.trim().replace(/\s+/g, ' ')).filter(Boolean))]
      if (!serviceAreas.length) throw new Error('Add at least one service area.')
      if (serviceAreas.length > 8) throw new Error('Add no more than 8 service areas.')
      if (serviceAreas.some((area) => area.length > 40)) throw new Error('Each service area must be 40 characters or fewer.')
      const partnerId = action.partnerId.trim().toUpperCase()
      if (!/^DP-\d{4}$/.test(partnerId)) throw new Error('Partner ID must look like DP-0000.')
      if (data.partners.some((partner) => partner.id === partnerId)) throw new Error(`${partnerId} is already used by another partner.`)
      const registrationDigits = action.registrationLast4.replace(/\D/g, '')
      if (registrationDigits && registrationDigits.length !== 4) throw new Error('Enter the last four digits of the vehicle registration, or leave it blank.')
      const note = action.note.trim()
      if (note.length > 240) throw new Error('The internal note must be 240 characters or fewer.')

      const maskedPhone = maskPhoneNumber(phoneDigits)
      const duplicate = data.partners.find((partner) => normalizeLinkName(partner.name) === normalizeLinkName(name) && partner.maskedPhone === maskedPhone)
      if (duplicate) throw new Error(`${duplicate.name} (${duplicate.id}) already uses this phone number.`)

      const partner: Partner = {
        id: partnerId,
        name,
        maskedPhone,
        demoPhone: null,
        maskedEmail: maskEmailAddress(email || null),
        registeredAt: at,
        vehicle: action.vehicle,
        maskedRegistration: registrationDigits ? `WB-••-${registrationDigits}` : 'Not provided',
        serviceAreas,
        availability: 'Offline',
        restrictedReason: null,
        suspendedReason: null,
        suspendedUntil: null,
        suspensionDays: null,
        needsOperationalReview: false,
        partnerAppUid: null,
      }
      data.partners.unshift(partner)
      data.settings.requiredDocuments.forEach((type, index) => {
        data.documents.push({
          id: `DOC-${partnerId.slice(-4)}-${index + 1}`,
          partnerId,
          type,
          submittedAt: null,
          status: 'Missing',
          expiresAt: null,
          reviewer: null,
          rejectionReason: null,
          history: [],
          demoRecord: true,
        })
      })
      partnerHistory(data, partnerId, 'Partner created', `Partner record created by ${data.user.name} from the admin console. The partner starts offline with mandatory documents missing.${note ? ` Note: ${note}` : ''}`, null, at)
      audit(data, 'Partner created', 'Partner', partnerId, 'Not in the directory', `${partnerId} · ${name}`, note || `Partner record created by ${data.user.name} with mandatory documents missing.`, at)
      notify(data, 'Verification Required', 'New partner needs KYC verification', `${name} (${partnerId}) was added by ${data.user.name}. Mandatory documents are missing and the partner is offline.`, `/admin/partners/${partnerId}`, partnerId, at)
      return { message: `${name} created as ${partnerId}. The partner is offline until the mandatory documents are verified.` }
    }
    case 'partner.restrict': {
      const partner = findPartner(data, action.partnerId)
      requireValue(action.reason, 'Restriction reason')
      if (partner.availability === action.status) throw new Error(`${partner.name} is already ${action.status.toLowerCase()}.`)
      if (partner.availability === 'Suspended' && action.status === 'Restricted') throw new Error('Restore the partner before changing a suspension to a restriction.')
      let suspendedUntil: string | null = null
      let suspensionDays: number | null = null
      if (action.status === 'Suspended') {
        // Keep reducer callers backwards-compatible; the UI always supplies
        // an explicit duration, while older integrations receive the default.
        const days = action.durationDays === undefined ? DEFAULT_SUSPENSION_DAYS : Number(action.durationDays)
        if (!isValidSuspensionDays(days)) throw new Error('Suspension length must be a whole number from 1 to 365 days.')
        suspensionDays = days
        suspendedUntil = suspensionEnd(at, days)
      }
      const previous = partner.availability
      partner.availability = action.status
      partner.restrictedReason = action.status === 'Restricted' ? action.reason.trim() : null
      partner.suspendedReason = action.status === 'Suspended' ? action.reason.trim() : null
      partner.suspendedUntil = suspendedUntil
      partner.suspensionDays = suspensionDays
      const active = getActiveAssignment(data, partner.id)
      partner.needsOperationalReview = Boolean(active)
      const timeline = suspendedUntil ? ` for ${suspensionDaysLabel(suspensionDays ?? 0)} (until ${formatSuspensionEnd(suspendedUntil) ?? 'the scheduled end'})` : ''
      partnerHistory(data, partner.id, action.status, `${action.status}${timeline}: ${action.reason.trim()}${active ? `. Existing ${active.deliveryId} assignment flagged for review.` : ''}`, active?.deliveryId ?? null, at)
      const event = action.status === 'Restricted' ? 'Partner restricted' : 'Partner suspended'
      const newValue = suspendedUntil ? `Suspended until ${formatSuspensionEnd(suspendedUntil) ?? suspendedUntil}` : action.status
      audit(data, event, 'Partner', partner.id, previous, newValue, action.reason, at)
      audit(data, 'Partner eligibility changed', 'Partner', partner.id, 'Eligible state recalculated', 'Ineligible for new offers', action.reason, at)
      const category = action.status === 'Restricted' ? 'Partner Restricted' : 'Partner Suspended'
      notify(data, category, `Partner ${action.status.toLowerCase()}`, `${partner.name} is ${action.status.toLowerCase()}${timeline}: ${action.reason.trim()}`, `/admin/partners/${partner.id}`, partner.id, at)
      const actionLabel = action.status === 'Suspended' ? `suspended${timeline}` : 'restricted'
      return { message: `${partner.name} ${actionLabel}. Existing assignment${active ? ` ${active.deliveryId} was flagged for review` : 's were not changed'}.` }
    }
    case 'partner.restore': {
      const partner = findPartner(data, action.partnerId)
      requireValue(action.reason, 'Reinstatement reason')
      if (partner.availability !== 'Restricted' && partner.availability !== 'Suspended') throw new Error(`${partner.name} is not restricted or suspended.`)
      const previous = partner.availability
      partner.restrictedReason = null
      partner.suspendedReason = null
      partner.suspendedUntil = null
      partner.suspensionDays = null
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
      return { message: approveApplication(data, application, action.note, at).message }
    }
    case 'application.reject': {
      const application = findApplication(data, action.applicationId)
      return { message: rejectApplication(data, application, action.reason, at).message }
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
      const previousTicketIds = new Set(data.partnerAppTickets.map((ticket) => ticket.id))
      data.partnerAppRecords = action.records.slice(0, 1000).map((record) => ({
        ...record,
        isOnline: typeof record.isOnline === 'boolean'
          ? record.isOnline
          : typeof record.status === 'string' && ['online', 'available', 'true'].includes(record.status.trim().toLowerCase())
            ? true
            : typeof record.status === 'string' && ['offline', 'unavailable', 'false'].includes(record.status.trim().toLowerCase())
              ? false
              : null,
      }))
      data.partnerAppTickets = Array.isArray(action.tickets) ? action.tickets.slice(0, 1000) : data.partnerAppTickets
      data.partnerAppDocuments = Array.isArray(action.documents) ? action.documents.slice(0, 1000) : data.partnerAppDocuments
      data.partnerApp.lastError = null
      data.partnerApp.lastSyncAt = action.at
      data.partnerApp.lastConnectedAt = action.at
      data.partnerApp.lastError = null
      autoLinkPartnerAppRecords(data)
      importApprovedPartnerAppRecords(data, at)
      syncLinkedPartnerProfile(data)
      syncLinkedPartnerAvailability(data)
      for (const ticket of data.partnerAppTickets) {
        if (previousTicketIds.has(ticket.id)) continue
        const partner = data.partners.find((item) => item.partnerAppUid === ticket.partnerUid)
        const path = partner ? `/admin/partners/${partner.id}` : '/admin/partners?view=app'
        notify(data, 'Partner Support Ticket', `New support ticket: ${ticket.subject}`, `${partner?.name ?? ticket.partnerUid}: ${ticket.message}`, path, ticket.id, at)
      }
      const linkedCount = data.partners.filter((partner) => partner.partnerAppUid).length
      // Background presence polls should update data without writing an audit
      // entry or raising a toast on every online/offline change.
      if (!action.silent) {
        audit(data, 'Partner app data synced', 'Settings', 'partner-app', `${previousCount} cached records`, `${data.partnerAppRecords.length} cached records · ${linkedCount} linked partners`, 'Partner records synced from delivery_app.', at)
      }
      return { message: `${data.partnerAppRecords.length} partner app record${data.partnerAppRecords.length === 1 ? '' : 's'} synced.${linkedCount ? ` ${linkedCount} partner${linkedCount === 1 ? '' : 's'} linked by name.` : ' Link records to admin partners before using live account actions.'}` }
    }
    case 'partnerApp.failed': {
      data.partnerApp.lastError = action.message.trim() || 'Partner app request failed.'
      return { message: data.partnerApp.lastError, kind: 'error' }
    }
    case 'partnerApp.link': {
      const partner = findPartner(data, action.partnerId)
      const record = data.partnerAppRecords.find((item) => item.id === action.recordId)
      if (!record) throw new Error('Sync partner app data before linking a delivery_app account.')
      if (partner.partnerAppUid === record.id) throw new Error(`${partner.name} is already linked to this delivery_app account.`)
      const previous = partner.partnerAppUid ?? 'Not linked'
      for (const other of data.partners) {
        if (other.id !== partner.id && other.partnerAppUid === record.id) other.partnerAppUid = null
      }
      for (const application of data.applications) {
        if (application.partnerAppUid === record.id) application.partnerAppUid = null
      }
      partner.partnerAppUid = record.id
      const related = data.applications.filter((application) => application.partnerId === partner.id
        || normalizeLinkName(application.applicantName) === normalizeLinkName(partner.name))
      for (const application of related) application.partnerAppUid = record.id
      syncLinkedPartnerProfile(data)
      audit(data, 'Partner app account updated', 'Partner', partner.id, previous, `${record.id} · ${record.name}`, `Linked manually from the partner app data view.${related.length ? ` ${related.length} application record${related.length === 1 ? '' : 's'} linked too.` : ''}`, at)
      return { message: `${partner.name} linked to delivery_app account ${record.id}.` }
    }
    case 'partnerApp.unlink': {
      const partner = findPartner(data, action.partnerId)
      if (!partner.partnerAppUid) throw new Error(`${partner.name} is not linked to a delivery_app account.`)
      const previous = partner.partnerAppUid
      partner.partnerAppUid = null
      for (const application of data.applications) {
        if (application.partnerAppUid === previous) application.partnerAppUid = null
      }
      audit(data, 'Partner app account updated', 'Partner', partner.id, previous, 'Not linked', 'Unlinked from the partner app data view. Local admin records are unchanged.', at)
      return { message: `${partner.name} unlinked from delivery_app account ${previous}.` }
    }
    case 'partnerApp.review': {
      const record = data.partnerAppRecords.find((item) => item.id === action.recordId)
      if (!record) throw new Error('Sync partner app data before reviewing a delivery_app application.')
      const linkedPartner = data.partners.find((partner) => partner.partnerAppUid === record.id)
      let application = data.applications.find((item) => item.partnerAppUid === record.id)
        ?? (linkedPartner ? data.applications.find((item) => item.partnerId === linkedPartner.id) : undefined)
      const recordStatus = (record.applicationStatus ?? '').toLowerCase()

      if (application && application.status !== 'Submitted') {
        if (application.status === 'Approved') throw new Error(`${application.id} is already approved.`)
        // delivery_app must resubmit before a rejected application can be reviewed again.
        if (recordStatus !== 'submitted' && recordStatus !== 'under_review') {
          throw new Error(`${application.id} is rejected and delivery_app has not resubmitted it.`)
        }
        application.status = 'Submitted'
        application.submittedAt = record.updatedAt ?? at
        application.reviewedBy = null
        application.reviewedAt = null
        application.decisionReason = null
      }

      if (!application) {
        application = applicationFromPartnerRecord(data, record)
        if (linkedPartner) application.partnerId = linkedPartner.id
        data.applications.unshift(application)
      }

      application.partnerAppUid ??= record.id
      if (action.decision === 'Approved') {
        const result = approveApplication(data, application, action.note, at, linkedPartner?.id ?? null)
        return { message: `${result.message} delivery_app will be updated when the Firebase administrator is signed in.` }
      }
      return { message: rejectApplication(data, application, action.note, at).message }
    }
    case 'partnerApp.ticket-status': {
      const ticket = data.partnerAppTickets.find((item) => item.id === action.ticketId)
      if (!ticket) throw new Error('Support ticket could not be found.')
      ticket.status = action.status
      ticket.updatedAt = action.at
      audit(data, 'Partner app account updated', 'Partner', ticket.partnerUid, 'Open', action.status, `Support ticket ${ticket.id} marked ${action.status}.`, action.at)
      return { message: `Ticket ${ticket.id} marked ${action.status.toLowerCase()}.` }
    }
    case 'partnerApp.document-review': {
      const record = data.partnerAppDocuments.find((item) => item.id === action.uid)
      const file = record?.files.find((item) => item.key === action.documentKey)
      if (!record || !file) throw new Error('Fetch the partner documents before reviewing them.')
      file.review = action.review
      audit(data, 'Document verification updated', 'Document', `${action.uid}:${action.documentKey}`, 'No admin review', action.review.status, action.review.note ?? 'Document reviewed by a main administrator.', action.at)
      return { message: `${action.documentKey} marked ${action.review.status.toLowerCase()}.` }
    }
    case 'partnerApp.write-result': {
      const message = action.message.trim() || (action.ok ? 'delivery_app account updated.' : 'delivery_app account update failed.')
      if (!action.ok) data.partnerApp.lastError = message
      else data.partnerApp.lastError = null
      if (action.targetType === 'Delivery') {
        const delivery = data.deliveries.find((item) => item.id === action.targetId)
        if (delivery) {
          delivery.publicationStatus = action.ok ? 'Published' : 'Failed'
          delivery.publishError = action.ok ? null : message
        }
      }
      if (action.ok) {
        const cached = data.partnerAppRecords.find((item) => item.id === action.recordId)
        if (cached) {
          if (action.applicationStatus) cached.applicationStatus = action.applicationStatus
          if (action.accountStatus) cached.status = action.accountStatus
          cached.updatedAt = action.at
          cached.fields = {
            ...cached.fields,
            ...(action.applicationStatus ? { applicationStatus: action.applicationStatus } : {}),
            ...(action.accountStatus ? { status: action.accountStatus } : {}),
            updatedAt: action.at,
          }
          syncLinkedPartnerAvailability(data)
        }
      }
      audit(data, 'Partner app account updated', action.targetType, action.targetId,
        'Admin decision recorded locally',
        action.ok ? 'delivery_app account updated' : 'delivery_app account update failed',
        message, action.at)
      return action.ok
        ? { message: `delivery_app account updated for ${action.targetId}.` }
        : { message: `delivery_app update failed for ${action.targetId}: ${message}`, kind: 'error' }
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
      audit(data, 'Settings modified', 'Settings', 'operations', previous, JSON.stringify(data.settings), 'Updated local configuration.', at)
      return { message: 'Settings saved locally.' }
    }
    case 'admin.create': {
      requireValue(action.name, 'Administrator name')
      requireValue(action.email, 'Administrator email')
      const email = normalizeAdminEmail(action.email)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid administrator email address.')
      if (data.admins.some((account) => account.email === email)) throw new Error(`${email} is already an administrator account.`)
      const role: AdminRole = action.role === 'Main Administrator' ? 'Main Administrator' : 'Restricted Administrator'
      if (role === 'Main Administrator' && activeMainAdmins(data).length >= 2) {
        throw new Error('Only two main administrators can have full access. Change an existing main administrator to restricted first.')
      }
      const access = normalizeAdminAccess(role, action.sections, action.permissions)
      const account: AdminAccount = {
        id: uid('ADM'),
        name: action.name.trim(),
        email,
        role,
        title: action.title.trim() || 'Delivery Operations Administrator',
        maskedPhone: 'Not provided',
        sections: access.sections,
        permissions: access.permissions,
        active: true,
        createdAt: at,
        lastSignedInAt: null,
      }
      data.admins.push(account)
      audit(data, 'Administrator created', 'Admin user', account.id, 'Not provisioned', adminAccessSummary(account), 'Administrator account created by a main administrator.', at)
      return { message: `${account.name} can now sign in with ${account.email}.` }
    }
    case 'admin.update': {
      const account = findAdmin(data, action.adminId)
      requireValue(action.name, 'Administrator name')
      const role: AdminRole = action.role === 'Main Administrator' ? 'Main Administrator' : 'Restricted Administrator'
      if (role === 'Main Administrator' && account.role !== 'Main Administrator' && activeMainAdmins(data).length >= 2) {
        throw new Error('Only two main administrators can have full access.')
      }
      if (account.active && account.role === 'Main Administrator' && role === 'Restricted Administrator' && activeMainAdmins(data).length <= 1) {
        throw new Error('At least one active main administrator must remain.')
      }
      const previous = adminAccessSummary(account)
      const access = normalizeAdminAccess(role, action.sections, action.permissions)
      account.name = action.name.trim()
      account.title = action.title.trim() || 'Delivery Operations Administrator'
      account.role = role
      account.sections = access.sections
      account.permissions = access.permissions
      if (account.email === normalizeAdminEmail(data.user.email)) {
        data.user = adminUserFromAccount(account, data.user.id)
      }
      audit(data, 'Administrator access changed', 'Admin user', account.id, previous, adminAccessSummary(account), 'Administrator access updated by a main administrator.', at)
      return { message: `${account.name}'s access has been updated.` }
    }
    case 'admin.set-active': {
      const account = findAdmin(data, action.adminId)
      if (account.email === normalizeAdminEmail(data.user.email)) {
        throw new Error('You cannot change your own administrator access here.')
      }
      if (action.active && account.active) throw new Error(`${account.name} is already active.`)
      if (!action.active && !account.active) throw new Error(`${account.name} is already inactive.`)
      if (action.active && account.role === 'Main Administrator' && activeMainAdmins(data).length >= 2) {
        throw new Error('Only two main administrators can have full access. Change one to restricted before reactivating this account.')
      }
      if (!action.active && account.role === 'Main Administrator' && activeMainAdmins(data).length <= 1) {
        throw new Error('At least one active main administrator must remain.')
      }
      account.active = action.active
      audit(
        data,
        action.active ? 'Administrator reactivated' : 'Administrator deactivated',
        'Admin user',
        account.id,
        action.active ? 'Inactive' : 'Active',
        action.active ? 'Active' : 'Inactive',
        action.reason.trim() || 'No additional note.',
        at,
      )
      return { message: `${account.name} is now ${action.active ? 'active' : 'inactive'}.` }
    }
    case 'user.identify': {
      const account = data.admins.find((item) => item.email === normalizeAdminEmail(action.email))
      if (!account || !account.active) {
        data.user = {
          id: action.id.trim() || 'UNPROVISIONED',
          name: action.name.trim() || account?.name || 'Unprovisioned administrator',
          email: action.email.trim(),
          role: 'Restricted Administrator',
          title: account?.title || 'Access not provisioned',
          maskedPhone: account?.maskedPhone || 'Not provided',
          sections: [],
          permissions: [],
          provisioned: false,
        }
        return { message: 'This account has no active administrator access.' }
      }
      account.lastSignedInAt = at
      data.user = adminUserFromAccount(account, action.id)
      return { message: 'Administrator identity synchronized.' }
    }
    case 'demo.reset': {
      const reset = createDemoState()
      reset.admins = data.admins
      reset.user = data.user
      reset.auditLogs.push({
        id: uid('EVT'), eventType: 'Local data reset', operator: data.user.name, operatorRole: data.user.role,
        targetType: 'Local data', targetId: 'local-data', previousValue: 'Saved local changes', newValue: 'Seed data restored',
        timestamp: at, reason: 'Reset confirmed by operator.',
      })
      Object.assign(data, reset)
      return { message: 'Demo data reloaded with the sample partners and deliveries.' }
    }
    case 'offer.expire-due':
      throw new Error('Internal offer sweep must be handled by the scheduler.')
    case 'delivery.sync-live-orders':
      throw new Error('Live order reconciliation must be handled by the scheduler.')
    case 'state.hydrate':
      throw new Error('Shared state hydration must be handled by the provider.')
    case 'partner.expire-suspensions':
      throw new Error('Internal suspension sweep must be handled by the scheduler.')
  }
  return { message: 'No operation performed.' }
}

function expireDue(data: OperationsState, now: number) {
  const expired = data.offers.filter((offer) => offer.status === 'Awaiting Response' && new Date(offer.expiresAt).getTime() <= now)
  if (!expired.length) return 0
  const at = new Date(now).toISOString()
  for (const offer of expired) timeoutOffer(data, offer.id, at)
  return expired.length
}

function expireSuspensions(data: OperationsState, now: number) {
  const expired = data.partners.filter((partner) => partner.availability === 'Suspended'
    && partner.suspendedUntil
    && new Date(partner.suspendedUntil).getTime() <= now)
  if (!expired.length) return 0
  const at = new Date(now).toISOString()
  for (const partner of expired) {
    const active = getActiveAssignment(data, partner.id)
    const length = partner.suspensionDays ? `${suspensionDaysLabel(partner.suspensionDays)} ` : ''
    partner.availability = active ? 'On Delivery' : 'Available'
    partner.suspendedReason = null
    partner.suspendedUntil = null
    partner.suspensionDays = null
    partner.needsOperationalReview = Boolean(active)
    partnerHistory(
      data,
      partner.id,
      'Suspension expired',
      `Automatic reinstatement after the ${length}suspension period ended.${active ? ` Existing ${active.deliveryId} assignment still needs operational review.` : ''}`,
      active?.deliveryId ?? null,
      at,
    )
    audit(data, 'Partner suspension expired', 'Partner', partner.id, 'Suspended', partner.availability, 'Suspension period ended automatically.', at)
  }
  return expired.length
}

export function appReducer(frame: AppFrame, action: OperationAction): AppFrame {
  if (action.type === 'delivery.sync-live') {
    // Reconciles console records with the partner app's live lifecycle: when
    // the partner completes or cancels in their app, the matching local
    // assignment is released so the partner becomes eligible again. Silent
    // while there is nothing to sync, because it runs on a poll.
    const data = structuredClone(frame.data)
    try {
      const count = syncLiveDeliveries(data, action.deliveries, action.at)
      if (!count) return frame
      return { ...frame, data, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'info', message: `${count} delivery record${count === 1 ? '' : 's'} synced from the partner app.` } }
    } catch (error) {
      return { ...frame, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'error', message: error instanceof Error ? error.message : 'Partner app sync could not be recorded.' } }
    }
  }

  if (action.type === 'state.hydrate') {
    return { ...frame, data: action.state, sequence: frame.sequence + 1, feedback: null }
  }

  if (action.type === 'delivery.sync-live-orders') {
    const data = structuredClone(frame.data)
    try {
      const count = syncLiveOrders(data, action.orders, action.at)
      if (!count) return frame
      // Background reconciliation should not raise a toast for every poll.
      return { ...frame, data, sequence: frame.sequence + 1, feedback: null }
    } catch (error) {
      return { ...frame, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'error', message: error instanceof Error ? error.message : 'Live order sync could not be recorded.' } }
    }
  }

  if (action.type === 'offer.expire-due') {
    const data = structuredClone(frame.data)
    try {
      const count = expireDue(data, action.now)
      if (!count) return frame
      return { ...frame, data, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'info', message: `${count} offer${count === 1 ? '' : 's'} timed out.` } }
    } catch (error) {
      return { ...frame, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'error', message: error instanceof Error ? error.message : 'Offer timeout could not be recorded.' } }
    }
  }

  if (action.type === 'partner.expire-suspensions') {
    const data = structuredClone(frame.data)
    try {
      const count = expireSuspensions(data, action.now)
      if (!count) return frame
      return { ...frame, data, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'info', message: `${count} partner suspension${count === 1 ? '' : 's'} ended automatically.` } }
    } catch (error) {
      return { ...frame, sequence: frame.sequence + 1, feedback: { id: frame.sequence + 1, kind: 'error', message: error instanceof Error ? error.message : 'Suspension expiry could not be recorded.' } }
    }
  }

  const permission = permissionByAction[action.type]
  if (permission && !userCan(frame.data.user, permission)) {
    const sequence = frame.sequence + 1
    return { ...frame, sequence, feedback: { id: sequence, kind: 'error', message: `Your ${frame.data.user.role} account cannot perform this action.` } }
  }

  const data = structuredClone(frame.data)
  try {
    const result = applyAction(data, action)
    const sequence = frame.sequence + 1
    return {
      data,
      sequence,
      feedback: action.type === 'user.identify'
        || (action.type === 'partnerApp.sync-result' && action.silent)
        ? null
        : { id: sequence, kind: result.kind ?? 'success', message: result.message },
    }
  } catch (error) {
    const sequence = frame.sequence + 1
    return { ...frame, sequence, feedback: { id: sequence, kind: 'error', message: error instanceof Error ? error.message : 'The operation could not be completed.' } }
  }
}

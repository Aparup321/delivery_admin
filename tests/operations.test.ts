import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoState } from '../src/domain/seed.ts'
import { getPartnerEligibility, nextPartnerId } from '../src/domain/operations.ts'
import { buildKycQueue, liveApplicationStatus } from '../src/domain/kyc.ts'
import { appReducer, type AppFrame, type OperationAction } from '../src/state/operationsReducer.ts'
import { loadOperationsState, saveOperationsState } from '../src/data/persistence.ts'
import { normalizePartnerAppRecords, parseFirebaseConfigJson, partnerAppEndpoint } from '../src/services/partnerApp.ts'
import { buildPartnerAppWriteIntent } from '../src/services/partnerAppIntent.ts'
import { normalizeLiveDeliveries } from '../src/services/liveDeliveries.ts'
import { applyFirebaseConnectionDefaults, type FirebaseEnvConfig } from '../src/config/firebase.ts'
import type { PartnerAppConfig } from '../src/domain/model.ts'
import { DEFAULT_ADMIN_EMAIL } from '../src/domain/admin.ts'
import { clearAdminSession, createAdminSession, createDemoAdminSession, DEMO_OTP_CODE, isDemoOtpValid, readAdminSession, readDemoAdminSession, storeDemoAdminSession } from '../src/auth/adminSession.ts'
import { clearFirebaseAdminSession, readFirebaseAdminSession, storeFirebaseAdminSession, type FirebaseAdminSession } from '../src/services/firebaseAuth.ts'

function frameWithDemo(): AppFrame {
  return { data: createDemoState(), feedback: null, sequence: 0 }
}

function apply(frame: AppFrame, action: OperationAction) {
  return appReducer(frame, action)
}

function expectSuccess(frame: AppFrame) {
  assert.notEqual(frame.feedback?.kind, 'error', frame.feedback?.message)
}

test('the operations team demo exposes one Administrator with complete account details', () => {
  const user = createDemoState().user
  assert.equal(user.role, 'Admin')
  assert.equal(user.id, 'ADM-OPS-01')
  assert.equal(user.name, 'Operations Administrator')
  assert.equal(user.email, DEFAULT_ADMIN_EMAIL)
  assert.equal(user.title, 'Delivery Operations Administrator')
  assert.equal(user.maskedPhone, 'Not provided')
})

test('Administrator session is derived from Firebase Authentication and cleared on sign-out', () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
  })
  try {
    assert.equal(readAdminSession(), null)
    const firebase: FirebaseAdminSession = {
      uid: 'firebase-uid-1',
      email: 'ops@example.com',
      displayName: 'Ops Lead',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      signedInAt: '2026-05-01T09:30:00.000Z',
    }
    store.set('picdrop-firebase-admin-session-v1', JSON.stringify(firebase))
    const session = readAdminSession()
    assert.equal(session?.userId, 'firebase-uid-1')
    assert.equal(session?.email, 'ops@example.com')
    assert.equal(session?.name, 'Ops Lead')
    assert.equal(session?.mode, 'Firebase Authentication')
    assert.deepEqual(createAdminSession(firebase), session)
    assert.equal(clearAdminSession(), true)
    assert.equal(readAdminSession(), null)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('the persistent Firebase session reconnects after an app restart without storing an ID token', () => {
  const tabStore = new Map<string, string>()
  const diskStore = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => tabStore.get(key) ?? null,
        setItem: (key: string, value: string) => { tabStore.set(key, value) },
        removeItem: (key: string) => { tabStore.delete(key) },
      },
      localStorage: {
        getItem: (key: string) => diskStore.get(key) ?? null,
        setItem: (key: string, value: string) => { diskStore.set(key, value) },
        removeItem: (key: string) => { diskStore.delete(key) },
      },
    },
  })
  try {
    const firebase: FirebaseAdminSession = {
      uid: 'firebase-uid-2',
      email: 'ops@example.com',
      displayName: 'Ops Lead',
      idToken: 'short-lived-id-token',
      refreshToken: 'long-lived-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      signedInAt: '2026-05-01T09:30:00.000Z',
    }
    storeFirebaseAdminSession(firebase)
    const persistedRaw = diskStore.get('picdrop-firebase-admin-session-persisted-v1')
    assert.ok(persistedRaw)
    const persisted = JSON.parse(persistedRaw) as FirebaseAdminSession
    assert.equal(persisted.refreshToken, 'long-lived-refresh-token')
    assert.equal(persisted.idToken, '')
    assert.equal(persisted.expiresAt, 0)

    // Simulate a browser restart: the tab session is gone, only disk remains.
    clearFirebaseAdminSession()
    diskStore.set('picdrop-firebase-admin-session-persisted-v1', persistedRaw)
    const restored = readFirebaseAdminSession()
    assert.equal(restored?.uid, 'firebase-uid-2')
    assert.equal(restored?.refreshToken, 'long-lived-refresh-token')
    assert.equal(restored?.idToken, '')
    assert.equal(readAdminSession()?.mode, 'Firebase Authentication')
  } finally {
    clearFirebaseAdminSession()
    delete (globalThis as { window?: unknown }).window
  }
})

test('demo access can keep a separate Firebase data connection', () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
  })
  try {
    clearAdminSession()
    storeDemoAdminSession(createDemoAdminSession())
    storeFirebaseAdminSession({
      uid: 'firebase-data-uid',
      email: 'ops@example.com',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      signedInAt: '2026-05-01T09:30:00.000Z',
    })
    assert.equal(readAdminSession()?.mode, 'Demo access')
    assert.equal(readFirebaseAdminSession()?.uid, 'firebase-data-uid')
  } finally {
    clearAdminSession()
    delete (globalThis as { window?: unknown }).window
  }
})

test('demo access uses the documented one-time code and a local demo session', () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
  })
  try {
    assert.equal(isDemoOtpValid(DEMO_OTP_CODE), true)
    assert.equal(isDemoOtpValid('000000'), false)
    storeDemoAdminSession(createDemoAdminSession())
    const demo = readDemoAdminSession()
    assert.equal(demo?.mode, 'Demo access')
    assert.equal(demo?.email, 'admin@picdrop.demo')
    assert.equal(demo?.role, 'Admin')
    assert.deepEqual(readAdminSession(), demo)
    assert.equal(clearAdminSession(), true)
    assert.equal(readDemoAdminSession(), null)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('the signed-in Firebase identity replaces the placeholder administrator in local state', () => {
  const frame = frameWithDemo()
  const identified = apply(frame, { type: 'user.identify', id: 'firebase-uid-1', name: 'Ops Lead', email: 'ops@example.com' })
  assert.equal(identified.data.user.id, 'firebase-uid-1')
  assert.equal(identified.data.user.name, 'Ops Lead')
  assert.equal(identified.data.user.email, 'ops@example.com')
  assert.equal(identified.feedback, null)
})

test('assignment validates eligibility and updates shared delivery, partner, history, audit, and notification records', () => {
  const frame = frameWithDemo()
  const next = apply(frame, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  expectSuccess(next)
  const delivery = next.data.deliveries.find((item) => item.id === 'DLV-1046')!
  const partner = next.data.partners.find((item) => item.id === 'DP-0187')!
  assert.equal(delivery.status, 'Assigned')
  assert.ok(delivery.assignmentId)
  assert.equal(partner.availability, 'On Delivery')
  assert.equal(next.data.assignments.filter((item) => item.deliveryId === delivery.id && item.status === 'Active').length, 1)
  assert.ok(next.data.partnerHistory.some((item) => item.partnerId === partner.id && item.type === 'Assignment received'))
  assert.ok(next.data.auditLogs.some((item) => item.eventType === 'Delivery assigned' && item.targetId === delivery.id))
  assert.ok(next.data.notifications.some((item) => item.category === 'Delivery Assigned' && item.relatedRecordId === delivery.id))
})

test('ineligible or duplicate partner assignment is rejected with an actionable reason', () => {
  const frame = frameWithDemo()
  const rejected = apply(frame, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0168' })
  assert.equal(rejected.feedback?.kind, 'error')
  assert.match(rejected.feedback?.message ?? '', /expired/i)
  const duplicate = apply(frame, { type: 'delivery.assign', deliveryId: 'DLV-1048', partnerId: 'DP-0192' })
  assert.equal(duplicate.feedback?.kind, 'error')
  assert.match(duplicate.feedback?.message ?? '', /already on an active delivery|already assigned/i)
})

test('the shared action layer rejects writes for Viewer and permits local demo persona switching', () => {
  const frame = frameWithDemo()
  frame.data.user.role = 'Viewer'
  const blocked = apply(frame, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.deliveries.find((item) => item.id === 'DLV-1046')?.status, 'Unassigned')
  const switched = apply(blocked, { type: 'user.set-role', role: 'Admin' })
  expectSuccess(switched)
  assert.equal(switched.data.user.role, 'Admin')
})

test('delivery milestones advance in order and completion releases partner availability', () => {
  let frame = frameWithDemo()
  const delivery = frame.data.deliveries.find((item) => item.id === 'DLV-1047')!
  assert.equal(delivery.milestones.filter((item) => item.completedAt).length, 1)
  for (let index = 0; index < 5; index++) {
    frame = apply(frame, { type: 'delivery.advance', deliveryId: delivery.id })
    expectSuccess(frame)
  }
  const completed = frame.data.deliveries.find((item) => item.id === delivery.id)!
  assert.equal(completed.status, 'Completed')
  assert.equal(completed.milestones.filter((item) => item.completedAt).length, 6)
  assert.equal(frame.data.assignments.find((item) => item.id === completed.assignmentId)?.status, 'Completed')
  assert.equal(frame.data.partners.find((item) => item.id === 'DP-0189')?.availability, 'Available')
  assert.ok(frame.data.notifications.some((item) => item.category === 'Delivery Completed' && item.relatedRecordId === delivery.id))
})

test('delay preserves milestone progress, blocks progression, and restores prior status when resolved', () => {
  let frame = frameWithDemo()
  const delivery = frame.data.deliveries.find((item) => item.id === 'DLV-1048')!
  const previousProgress = delivery.milestones.filter((item) => item.completedAt).length
  frame = apply(frame, { type: 'delivery.delay', deliveryId: delivery.id, reason: 'Demo test delay' })
  expectSuccess(frame)
  assert.equal(frame.data.deliveries.find((item) => item.id === delivery.id)?.status, 'Delayed')
  assert.equal(frame.data.deliveries.find((item) => item.id === delivery.id)?.milestones.filter((item) => item.completedAt).length, previousProgress)
  const blocked = apply(frame, { type: 'delivery.advance', deliveryId: delivery.id })
  assert.equal(blocked.feedback?.kind, 'error')
  frame = apply(frame, { type: 'delivery.clear-delay', deliveryId: delivery.id, reason: 'Demo test resolution' })
  expectSuccess(frame)
  assert.equal(frame.data.deliveries.find((item) => item.id === delivery.id)?.status, 'In Transit')
  assert.equal(frame.data.deliveries.find((item) => item.id === delivery.id)?.milestones.filter((item) => item.completedAt).length, previousProgress)
})

test('cancellation requires a reason, preserves assignment history, and releases partner', () => {
  let frame = frameWithDemo()
  frame = apply(frame, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  expectSuccess(frame)
  const assignmentId = frame.data.deliveries.find((item) => item.id === 'DLV-1046')!.assignmentId!
  const invalid = apply(frame, { type: 'delivery.cancel', deliveryId: 'DLV-1046', reason: ' ' })
  assert.equal(invalid.feedback?.kind, 'error')
  frame = apply(frame, { type: 'delivery.cancel', deliveryId: 'DLV-1046', reason: 'Demo cancellation test' })
  expectSuccess(frame)
  assert.equal(frame.data.deliveries.find((item) => item.id === 'DLV-1046')?.status, 'Cancelled')
  assert.equal(frame.data.assignments.find((item) => item.id === assignmentId)?.status, 'Released')
  assert.equal(frame.data.partners.find((item) => item.id === 'DP-0187')?.availability, 'Available')
})

test('offer create/send/accept lifecycle assigns exactly once and records offer state history', () => {
  let frame = frameWithDemo()
  frame = apply(frame, { type: 'offer.create', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  expectSuccess(frame)
  const offer = frame.data.offers[0]
  assert.equal(offer.status, 'Created')
  const duplicate = apply(frame, { type: 'offer.create', deliveryId: 'DLV-1046', partnerId: 'DP-0171' })
  assert.equal(duplicate.feedback?.kind, 'error')
  frame = apply(frame, { type: 'offer.send', offerId: offer.id })
  expectSuccess(frame)
  assert.equal(frame.data.offers[0].status, 'Awaiting Response')
  frame = apply(frame, { type: 'offer.accept', offerId: offer.id })
  expectSuccess(frame)
  assert.equal(frame.data.offers.find((item) => item.id === offer.id)?.status, 'Accepted')
  assert.equal(frame.data.deliveries.find((item) => item.id === 'DLV-1046')?.status, 'Assigned')
  assert.deepEqual(frame.data.offers.find((item) => item.id === offer.id)?.stateHistory.map((step) => step.status), ['Created', 'Sent', 'Awaiting Response', 'Accepted'])
})

test('offer rejection and timeout create audit and notification records; fallback remains off by default', () => {
  let frame = frameWithDemo()
  frame = apply(frame, { type: 'offer.create', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  const rejectedOfferId = frame.data.offers[0].id
  frame = apply(frame, { type: 'offer.send', offerId: rejectedOfferId })
  frame = apply(frame, { type: 'offer.reject', offerId: rejectedOfferId, reason: 'Demo partner declined' })
  expectSuccess(frame)
  assert.ok(frame.data.auditLogs.some((item) => item.eventType === 'Assignment offer rejected'))
  assert.ok(frame.data.notifications.some((item) => item.category === 'Partner Rejected Offer'))

  frame = apply(frame, { type: 'offer.create', deliveryId: 'DLV-1046', partnerId: 'DP-0171' })
  const timedOfferId = frame.data.offers[0].id
  frame = apply(frame, { type: 'offer.send', offerId: timedOfferId })
  frame = apply(frame, { type: 'offer.expire', offerId: timedOfferId })
  expectSuccess(frame)
  assert.equal(frame.data.offers.find((item) => item.id === timedOfferId)?.status, 'Timed Out')
  assert.equal(frame.data.offers.filter((item) => item.deliveryId === 'DLV-1046' && item.status === 'Awaiting Response').length, 0)
  assert.ok(frame.data.auditLogs.some((item) => item.eventType === 'Assignment offer timed out'))
  assert.ok(frame.data.notifications.some((item) => item.category === 'Assignment Offer Expired'))
})

test('fallback creates a next-eligible offer only when explicitly enabled', () => {
  let frame = frameWithDemo()
  frame.data.settings.fallbackEnabled = true
  frame = apply(frame, { type: 'offer.create', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  const firstOffer = frame.data.offers[0]
  frame = apply(frame, { type: 'offer.send', offerId: firstOffer.id })
  frame = apply(frame, { type: 'offer.expire', offerId: firstOffer.id })
  expectSuccess(frame)
  const fallback = frame.data.offers.find((offer) => offer.status === 'Awaiting Response')
  assert.ok(fallback)
  assert.notEqual(fallback.partnerId, firstOffer.partnerId)
  assert.equal(fallback.attempt, 2)
  assert.match(fallback.note ?? '', /fallback/i)
  assert.equal(frame.data.deliveries.find((item) => item.id === 'DLV-1046')?.status, 'Unassigned')
})

test('partner suspension blocks new assignment and flags but does not silently release active delivery', () => {
  const frame = frameWithDemo()
  const before = frame.data.deliveries.find((item) => item.id === 'DLV-1048')!
  const next = apply(frame, { type: 'partner.restrict', partnerId: 'DP-0192', status: 'Suspended', reason: 'Demo review hold' })
  expectSuccess(next)
  const partner = next.data.partners.find((item) => item.id === 'DP-0192')!
  assert.equal(partner.availability, 'Suspended')
  assert.equal(partner.needsOperationalReview, true)
  assert.equal(next.data.deliveries.find((item) => item.id === before.id)?.assignmentId, before.assignmentId)
  assert.equal(next.data.assignments.find((item) => item.id === before.assignmentId)?.status, 'Active')
  const target = next.data.deliveries.find((item) => item.id === 'DLV-1046')!
  assert.equal(getPartnerEligibility(next.data, partner, target).eligible, false)
})

test('partner suspension is recorded in activity and audit history, and an Administrator can reinstate the partner', () => {
  const frame = frameWithDemo()
  const suspended = apply(frame, { type: 'partner.restrict', partnerId: 'DP-0192', status: 'Suspended', reason: 'Demo review hold' })
  expectSuccess(suspended)
  const suspensionEvent = suspended.data.partnerHistory.find((item) => item.partnerId === 'DP-0192' && item.type === 'Suspended')
  assert.ok(suspensionEvent)
  assert.match(suspensionEvent.description, /Demo review hold/)
  assert.equal(suspensionEvent.actor, 'Operations Administrator')
  assert.ok(suspended.data.auditLogs.some((item) => item.eventType === 'Partner suspended' && item.targetId === 'DP-0192' && item.reason === 'Demo review hold'))
  assert.ok(suspended.data.notifications.some((item) => item.category === 'Partner Suspended' && item.relatedRecordId === 'DP-0192'))

  const restored = apply(suspended, { type: 'partner.restore', partnerId: 'DP-0192', reason: 'Operations review completed' })
  expectSuccess(restored)
  const partner = restored.data.partners.find((item) => item.id === 'DP-0192')!
  assert.equal(partner.availability, 'On Delivery')
  assert.equal(partner.suspendedReason, null)
  assert.equal(partner.needsOperationalReview, true)
  assert.ok(restored.data.partnerHistory.some((item) => item.partnerId === 'DP-0192' && item.type === 'Eligibility restored' && item.description.includes('Operations review completed')))
})

test('only an Administrator can approve an onboarding application, which onboards the partner and queues KYC documents', () => {
  const frame = frameWithDemo()
  frame.data.user.role = 'Operations Manager'
  const blocked = apply(frame, { type: 'application.approve', applicationId: 'APP-2041', note: '' })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.applications.find((item) => item.id === 'APP-2041')?.status, 'Submitted')

  blocked.data.user.role = 'Admin'
  const approved = apply(blocked, { type: 'application.approve', applicationId: 'APP-2041', note: 'Demo onboarding approval' })
  expectSuccess(approved)
  const application = approved.data.applications.find((item) => item.id === 'APP-2041')!
  assert.equal(application.status, 'Approved')
  assert.equal(application.decisionReason, 'Demo onboarding approval')
  assert.equal(approved.data.partners.length, frame.data.partners.length + 1)
  const partner = approved.data.partners.find((item) => item.id === application.partnerId)!
  assert.equal(partner.name, 'Rohan Mitra')
  assert.equal(partner.availability, 'Offline')
  const partnerDocuments = approved.data.documents.filter((item) => item.partnerId === partner.id)
  assert.equal(partnerDocuments.length, approved.data.settings.requiredDocuments.length)
  assert.ok(partnerDocuments.every((item) => item.status === 'Submitted'))
  assert.ok(approved.data.partnerHistory.some((item) => item.partnerId === partner.id && item.type === 'Application approved'))
  assert.ok(approved.data.auditLogs.some((item) => item.eventType === 'Application approved' && item.targetId === 'APP-2041'))
  assert.ok(approved.data.notifications.some((item) => item.category === 'Partner Application Approved' && item.relatedRecordId === 'APP-2041'))
})

test('rejecting an onboarding application requires a reason and never creates a partner', () => {
  const frame = frameWithDemo()
  const rejectedWithoutReason = apply(frame, { type: 'application.reject', applicationId: 'APP-2040', reason: ' ' })
  assert.equal(rejectedWithoutReason.feedback?.kind, 'error')
  const rejected = apply(frame, { type: 'application.reject', applicationId: 'APP-2040', reason: 'Vehicle registration document is missing.' })
  expectSuccess(rejected)
  const application = rejected.data.applications.find((item) => item.id === 'APP-2040')!
  assert.equal(application.status, 'Rejected')
  assert.equal(application.decisionReason, 'Vehicle registration document is missing.')
  assert.equal(application.partnerId, null)
  assert.equal(rejected.data.partners.length, frame.data.partners.length)
  assert.ok(rejected.data.auditLogs.some((item) => item.eventType === 'Application rejected' && item.targetId === 'APP-2040'))
})

test('an Administrator can create a partner directory record with missing mandatory documents', () => {
  const frame = frameWithDemo()
  const partnerId = nextPartnerId(frame.data)
  assert.match(partnerId, /^DP-\d{4}$/)
  assert.equal(Number(partnerId.slice(3)), Math.max(...frame.data.partners.map((partner) => Number(partner.id.slice(3)))) + 1)

  frame.data.user.role = 'Viewer'
  const blocked = apply(frame, {
    type: 'partner.create', partnerId, name: 'Sneha Bose', phone: '+91 98765 43210', email: 'sneha@example.com',
    vehicle: 'Scooter', serviceAreas: ['Barasat'], registrationLast4: '1234', note: '',
  })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.partners.some((partner) => partner.id === partnerId), false)

  blocked.data.user.role = 'Admin'
  const created = apply(blocked, {
    type: 'partner.create', partnerId, name: '  Sneha   Bose ', phone: '+91 98765 43210', email: 'sneha@example.com',
    vehicle: 'Scooter', serviceAreas: [' Barasat ', 'New Town', 'Barasat'], registrationLast4: '1234', note: 'Added from the admin console',
  })
  expectSuccess(created)
  const partner = created.data.partners.find((item) => item.id === partnerId)!
  assert.equal(partner.name, 'Sneha Bose')
  assert.equal(partner.availability, 'Offline')
  assert.equal(partner.partnerAppUid, null)
  assert.match(partner.maskedPhone, /3210$/)
  assert.equal(partner.maskedEmail, 'sneh••@example.com')
  assert.equal(partner.maskedRegistration, 'WB-••-1234')
  assert.deepEqual(partner.serviceAreas, ['Barasat', 'New Town'])

  const documents = created.data.documents.filter((item) => item.partnerId === partnerId)
  assert.equal(documents.length, created.data.settings.requiredDocuments.length)
  assert.ok(documents.every((item) => item.status === 'Missing' && item.submittedAt === null))
  assert.ok(created.data.partnerHistory.some((item) => item.partnerId === partnerId && item.type === 'Partner created'))
  assert.ok(created.data.auditLogs.some((item) => item.eventType === 'Partner created' && item.targetId === partnerId))
  assert.ok(created.data.notifications.some((item) => item.category === 'Verification Required' && item.relatedRecordId === partnerId))

  const duplicate = apply(created, {
    type: 'partner.create', partnerId, name: 'Another Person', phone: '+91 90000 11111', email: '',
    vehicle: 'Bike', serviceAreas: ['Kolkata'], registrationLast4: '', note: '',
  })
  assert.equal(duplicate.feedback?.kind, 'error')
  assert.match(duplicate.feedback?.message ?? '', /already used/)
  assert.equal(duplicate.data.partners.length, created.data.partners.length)
})

test('the KYC queue unifies local applications with synced delivery_app onboarding records', () => {
  const frame = frameWithDemo()
  const demoQueue = buildKycQueue(frame.data)
  assert.equal(demoQueue.length, frame.data.applications.length)
  assert.ok(demoQueue.every((item) => item.source === 'admin'))
  assert.equal(
    demoQueue.filter((item) => item.status === 'Submitted').length,
    frame.data.applications.filter((item) => item.status === 'Submitted').length,
  )
  const rejected = demoQueue.find((item) => item.status === 'Rejected')!
  assert.equal(rejected.decisionReason, 'Vehicle registration was not submitted with the application.')

  assert.equal(liveApplicationStatus('submitted'), 'Submitted')
  assert.equal(liveApplicationStatus('UNDER_REVIEW'), 'Submitted')
  assert.equal(liveApplicationStatus(' pending '), 'Submitted')
  assert.equal(liveApplicationStatus('approved'), 'Approved')
  assert.equal(liveApplicationStatus('rejected'), 'Rejected')
  assert.equal(liveApplicationStatus('draft'), null)
  assert.equal(liveApplicationStatus(null), null)

  const synced = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'live-kyc-uid', partnerId: 'live-kyc-uid', name: 'Aparup Santra', phone: '+91 98356 48245',
      email: 'aparup@example.com', vehicle: 'bike', status: 'pending', applicationStatus: 'under_review',
      serviceAreas: ['Barasat'], updatedAt: '2026-06-01T09:55:00.000Z',
      fields: { fullName: 'Aparup Santra', applicationStatus: 'under_review' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }, {
      id: 'session-only-uid', partnerId: 'session-only-uid', name: 'session-only-uid', phone: '+91 90000 00000',
      email: null, vehicle: null, status: null, applicationStatus: 'submitted', serviceAreas: [],
      updatedAt: '2026-06-01T09:55:00.000Z', fields: { phone: '+91 90000 00000' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  const liveQueue = buildKycQueue(synced.data)
  const liveItem = liveQueue.find((item) => item.recordId === 'live-kyc-uid')!
  assert.equal(liveItem.source, 'delivery_app')
  assert.equal(liveItem.status, 'Submitted')
  assert.equal(liveItem.partnerAppUid, 'live-kyc-uid')
  assert.equal(liveItem.applicantName, 'Aparup Santra')
  assert.equal(liveItem.businessName, 'delivery_app onboarding')
  assert.equal(liveItem.documentsKnown, false)
  const sessionOnly = liveQueue.find((item) => item.recordId === 'session-only-uid')!
  assert.equal(sessionOnly.status, 'KYC pending')
  assert.equal(sessionOnly.applicantName, '+91 90000 00000')
  assert.equal(sessionOnly.businessName, 'Onboarding in progress')
  assert.equal(sessionOnly.documentsKnown, false)

  const approved = apply(synced, { type: 'partnerApp.review', recordId: 'live-kyc-uid', decision: 'Approved', note: 'Verified in delivery_app' })
  expectSuccess(approved)
  const approvedMatches = buildKycQueue(approved.data).filter((item) => item.partnerAppUid === 'live-kyc-uid')
  assert.equal(approvedMatches.length, 1)
  assert.equal(approvedMatches[0].source, 'admin')
  assert.equal(approvedMatches[0].status, 'Approved')
})

test('a rejected live application becomes reviewable again after delivery_app resubmits', () => {
  const synced = apply(frameWithDemo(), {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'live-kyc-uid', partnerId: 'live-kyc-uid', name: 'Aparup Santra', phone: '+91 98356 48245',
      email: 'aparup@example.com', vehicle: 'bike', status: 'pending', applicationStatus: 'submitted',
      serviceAreas: ['Barasat'], updatedAt: '2026-06-01T09:55:00.000Z',
      fields: { fullName: 'Aparup Santra', applicationStatus: 'submitted' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  const rejected = apply(synced, { type: 'partnerApp.review', recordId: 'live-kyc-uid', decision: 'Rejected', note: 'Address proof is unreadable.' })
  expectSuccess(rejected)
  const rejectedItem = buildKycQueue(rejected.data).find((item) => item.recordId === 'live-kyc-uid')!
  assert.equal(rejectedItem.status, 'Rejected')
  assert.equal(rejectedItem.decisionReason, 'Address proof is unreadable.')
  assert.equal(rejectedItem.resubmitted, false)

  const application = rejected.data.applications.find((item) => item.partnerAppUid === 'live-kyc-uid')!
  const record = rejected.data.partnerAppRecords[0]
  record.applicationStatus = 'submitted'
  record.updatedAt = new Date(new Date(application.reviewedAt!).getTime() + 60_000).toISOString()
  const resubmittedItem = buildKycQueue(rejected.data).find((item) => item.recordId === 'live-kyc-uid')!
  assert.equal(resubmittedItem.status, 'Submitted')
  assert.equal(resubmittedItem.resubmitted, true)
  assert.equal(resubmittedItem.decisionReason, null)

  const approved = apply(rejected, { type: 'partnerApp.review', recordId: 'live-kyc-uid', decision: 'Approved', note: 'Resubmitted proof is clear.' })
  expectSuccess(approved)
  assert.equal(approved.data.applications.find((item) => item.partnerAppUid === 'live-kyc-uid')?.status, 'Approved')
})

test('partner app connection is administrator-only, validates manual details, and caches synced records', () => {
  const frame = frameWithDemo()
  frame.data.user.role = 'Operations Manager'
  const blocked = apply(frame, { type: 'partnerApp.save', config: { mode: 'firestore', projectId: 'delivery-app-demo', apiKey: '', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '' } })
  assert.equal(blocked.feedback?.kind, 'error')

  blocked.data.user.role = 'Admin'
  const invalidProject = apply(blocked, { type: 'partnerApp.save', config: { mode: 'firestore', projectId: ' ', apiKey: '', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '' } })
  assert.equal(invalidProject.feedback?.kind, 'error')
  const invalidEndpoint = apply(blocked, { type: 'partnerApp.save', config: { mode: 'endpoint', projectId: '', apiKey: '', databaseId: '(default)', partnersCollection: '', endpointUrl: 'ftp://example.com/partners' } })
  assert.equal(invalidEndpoint.feedback?.kind, 'error')

  const saved = apply(blocked, { type: 'partnerApp.save', config: { mode: 'firestore', projectId: 'delivery-app-demo', apiKey: 'demo-key', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '' } })
  expectSuccess(saved)
  assert.equal(saved.data.partnerApp.projectId, 'delivery-app-demo')
  assert.ok(saved.data.auditLogs.some((item) => item.eventType === 'Partner app connection updated'))

  const failed = apply(saved, { type: 'partnerApp.failed', message: 'Mock connection failure' })
  assert.equal(failed.data.partnerApp.lastError, 'Mock connection failure')

  const synced = apply(failed, {
    type: 'partnerApp.sync-result',
    at: '2026-05-01T10:00:00.000Z',
    records: [{
      id: 'partner-001', partnerId: 'DP-0192', name: 'Anirban G.', phone: '+91 90000 00000', email: 'anirban@delivery.app',
      vehicle: 'Bike', status: 'Online', serviceAreas: ['Barasat'], updatedAt: '2026-05-01T09:55:00.000Z',
      fields: { name: 'Anirban G.', status: 'Online' }, syncedAt: '2026-05-01T10:00:00.000Z',
    }],
  })
  expectSuccess(synced)
  assert.equal(synced.data.partnerAppRecords.length, 1)
  assert.equal(synced.data.partnerApp.lastSyncAt, '2026-05-01T10:00:00.000Z')
  assert.equal(synced.data.partnerApp.lastError, null)
  assert.ok(synced.data.auditLogs.some((item) => item.eventType === 'Partner app data synced'))
  assert.equal(synced.data.partners.find((partner) => partner.id === 'DP-0192')?.partnerAppUid, 'partner-001')
})

test('a live delivery_app application can be reviewed, approved, and linked without a local application record', () => {
  const frame = frameWithDemo()
  const records = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'live-partner-uid', partnerId: 'live-partner-uid', name: 'Aparup Santra', phone: '+91 98356 48245',
      email: 'aparup@example.com', vehicle: 'bike', status: 'pending', applicationStatus: 'submitted',
      serviceAreas: ['Barasat'], updatedAt: '2026-06-01T09:55:00.000Z',
      fields: { fullName: 'Aparup Santra', applicationStatus: 'submitted' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  expectSuccess(records)
  records.data.user.role = 'Operations Manager'

  const blocked = apply(records, { type: 'partnerApp.review', recordId: 'live-partner-uid', decision: 'Approved', note: '' })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.applications.some((item) => item.partnerAppUid === 'live-partner-uid'), false)

  blocked.data.user.role = 'Admin'
  const rejectedWithoutReason = apply(blocked, { type: 'partnerApp.review', recordId: 'live-partner-uid', decision: 'Rejected', note: ' ' })
  assert.equal(rejectedWithoutReason.feedback?.kind, 'error')

  const approved = apply(blocked, { type: 'partnerApp.review', recordId: 'live-partner-uid', decision: 'Approved', note: 'Checked in delivery_app' })
  expectSuccess(approved)
  const application = approved.data.applications.find((item) => item.partnerAppUid === 'live-partner-uid')!
  assert.equal(application.status, 'Approved')
  assert.equal(application.applicantName, 'Aparup Santra')
  assert.equal(application.demoRecord, false)
  const partner = approved.data.partners.find((item) => item.id === application.partnerId)!
  assert.equal(partner.name, 'Aparup Santra')
  assert.equal(partner.partnerAppUid, 'live-partner-uid')
  const approvalLog = approved.data.auditLogs.find((item) => item.eventType === 'Application approved' && item.targetId === application.id)!
  const approvalIntent = buildPartnerAppWriteIntent(approved.data, approvalLog)
  assert.equal(approvalIntent?.kind, 'application')
  if (approvalIntent?.kind === 'application') {
    assert.equal(approvalIntent.decision, 'Approved')
    assert.equal(approvalIntent.partnerAppUid, 'live-partner-uid')
    assert.equal(approvalIntent.adminPartnerId, partner.id)
    assert.equal(approvalIntent.reason, 'Checked in delivery_app')
  }

  const suspended = apply(approved, { type: 'partner.restrict', partnerId: partner.id, status: 'Suspended', reason: 'Chargeback investigation' })
  expectSuccess(suspended)
  const suspendLog = suspended.data.auditLogs.find((item) => item.eventType === 'Partner suspended' && item.targetId === partner.id)!
  const suspendIntent = buildPartnerAppWriteIntent(suspended.data, suspendLog)
  assert.equal(suspendIntent?.kind, 'account')
  if (suspendIntent?.kind === 'account') {
    assert.equal(suspendIntent.active, false)
    assert.equal(suspendIntent.reason, 'Chargeback investigation')
    assert.equal(suspendIntent.partnerAppUid, 'live-partner-uid')
  }

  const restored = apply(suspended, { type: 'partner.restore', partnerId: partner.id, reason: 'Investigation closed' })
  expectSuccess(restored)
  const restoreLog = restored.data.auditLogs.find((item) => item.eventType === 'Partner eligibility changed' && item.targetId === partner.id && item.previousValue === 'Suspended')!
  const restoreIntent = buildPartnerAppWriteIntent(restored.data, restoreLog)
  assert.equal(restoreIntent?.kind, 'account')
  if (restoreIntent?.kind === 'account') {
    assert.equal(restoreIntent.active, true)
    assert.equal(restoreIntent.reason, 'Investigation closed')
  }
})

test('demo partner phone numbers auto-link synced partner app records', () => {
  const synced = apply(frameWithDemo(), {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'live-anirban-uid', partnerId: null, name: 'Unknown Device', phone: '+91 90000 04100',
      email: null, vehicle: 'Bike', status: 'active', applicationStatus: 'approved',
      serviceAreas: ['Barasat'], updatedAt: '2026-06-01T09:55:00.000Z',
      fields: { phone: '+91 90000 04100' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }, {
      id: 'live-subhajit-uid', partnerId: null, name: 'Unknown Device Two', phone: '+91 90000 04511',
      email: null, vehicle: 'Bike', status: 'pending', applicationStatus: 'submitted',
      serviceAreas: ['Kolkata'], updatedAt: '2026-06-01T09:56:00.000Z',
      fields: { phone: '+91 90000 04511' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  expectSuccess(synced)
  assert.equal(synced.data.partners.find((partner) => partner.id === 'DP-0192')?.partnerAppUid, 'live-anirban-uid')
  assert.equal(synced.data.partners.find((partner) => partner.id === 'DP-0195')?.partnerAppUid, 'live-subhajit-uid')
  assert.equal(synced.data.applications.find((application) => application.id === 'APP-2038')?.partnerAppUid, 'live-subhajit-uid')
})

test('a successful delivery_app write updates the cached record while a failed write keeps it unchanged', () => {
  const frame = frameWithDemo()
  const synced = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'live-partner-uid', partnerId: 'live-partner-uid', name: 'Aparup Santra', phone: '+91 98356 48245',
      email: 'aparup@example.com', vehicle: 'bike', status: 'pending', applicationStatus: 'submitted',
      serviceAreas: ['Barasat'], updatedAt: '2026-06-01T09:55:00.000Z',
      fields: { fullName: 'Aparup Santra', applicationStatus: 'submitted', status: 'pending' },
      syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  const failed = apply(synced, {
    type: 'partnerApp.write-result', targetType: 'Application', targetId: 'APP-9001', recordId: 'live-partner-uid',
    ok: false, message: 'HTTP 403: Missing or insufficient permissions.', at: '2026-06-01T10:05:00.000Z',
    applicationStatus: 'rejected', accountStatus: 'pending',
  })
  assert.equal(failed.data.partnerAppRecords[0].applicationStatus, 'submitted')
  assert.equal(failed.data.partnerApp.lastError, 'HTTP 403: Missing or insufficient permissions.')

  const written = apply(synced, {
    type: 'partnerApp.write-result', targetType: 'Application', targetId: 'APP-9001', recordId: 'live-partner-uid',
    ok: true, message: 'rejected in delivery_app.', at: '2026-06-01T10:06:00.000Z',
    applicationStatus: 'rejected', accountStatus: 'pending',
  })
  expectSuccess(written)
  assert.equal(written.data.partnerAppRecords[0].applicationStatus, 'rejected')
  assert.equal(written.data.partnerAppRecords[0].status, 'pending')
  assert.equal(written.data.partnerAppRecords[0].fields.applicationStatus, 'rejected')
  assert.equal(written.data.partnerApp.lastError, null)
  assert.ok(written.data.auditLogs.some((item) => item.eventType === 'Partner app account updated' && item.targetId === 'APP-9001'))
})

test('live delivery_app review refuses accounts that have not completed onboarding', () => {
  const frame = frameWithDemo()
  const records = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'session-only-uid', partnerId: 'session-only-uid', name: 'session-only-uid', phone: '+91 90000 00000',
      email: null, vehicle: null, status: null, applicationStatus: null, serviceAreas: [],
      updatedAt: '2026-06-01T09:55:00.000Z', fields: { phone: '+91 90000 00000' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  const refused = apply(records, { type: 'partnerApp.review', recordId: 'session-only-uid', decision: 'Approved', note: '' })
  assert.equal(refused.feedback?.kind, 'error')
  assert.match(refused.feedback?.message ?? '', /has not completed onboarding/)
})

test('partner app responses are normalized from Firestore and plain JSON records', () => {
  const syncedAt = '2026-05-02T09:00:00.000Z'
  const firestore = normalizePartnerAppRecords({
    documents: [{
      name: 'projects/delivery-app/databases/(default)/documents/partners/p-100',
      updateTime: '2026-05-02T08:40:00.000Z',
      fields: {
        name: { stringValue: 'Rohan Mitra' },
        partnerId: { stringValue: 'DP-0192' },
        phone: { stringValue: '+91 90000 11111' },
        vehicle: { stringValue: 'Scooter' },
        status: { stringValue: 'Online' },
        serviceAreas: { arrayValue: { values: [{ stringValue: 'New Town' }, { stringValue: 'Rajarhat' }] } },
        rating: { doubleValue: 4.7 },
      },
    }],
  }, syncedAt)
  assert.equal(firestore.length, 1)
  assert.equal(firestore[0].id, 'p-100')
  assert.equal(firestore[0].name, 'Rohan Mitra')
  assert.equal(firestore[0].partnerId, 'DP-0192')
  assert.deepEqual(firestore[0].serviceAreas, ['New Town', 'Rajarhat'])
  assert.equal(firestore[0].updatedAt, '2026-05-02T08:40:00.000Z')
  assert.equal(firestore[0].fields['rating'], '4.7')

  const plain = normalizePartnerAppRecords({ 'p-200': { fullName: 'Sneha B.', vehicleType: 'Bike', availability: false } }, syncedAt)
  assert.equal(plain[0].id, 'p-200')
  assert.equal(plain[0].name, 'Sneha B.')
  assert.equal(plain[0].vehicle, 'Bike')
  assert.equal(plain[0].status, 'Offline')

  const config: PartnerAppConfig = { mode: 'firestore', projectId: 'delivery-app', apiKey: 'demo', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '', lastConnectedAt: null, lastSyncAt: null, lastError: null }
  assert.equal(partnerAppEndpoint(config, 1), 'https://firestore.googleapis.com/v1/projects/delivery-app/databases/(default)/documents/partners?pageSize=1&key=demo')
})

test('a pasted Firebase config fills the partner app connection values', () => {
  const consoleConfig = `const firebaseConfig = {
    apiKey: "AIzaDemoKey",
    authDomain: "delivery-app.firebaseapp.com",
    projectId: "delivery-app",
    firestoreDatabaseId: "delivery-app-db",
    storageBucket: "delivery-app.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
  };`
  const parsed = parseFirebaseConfigJson(consoleConfig)
  assert.equal(parsed.projectId, 'delivery-app')
  assert.equal(parsed.apiKey, 'AIzaDemoKey')
  assert.equal(parsed.databaseId, 'delivery-app-db')

  const wrapped = parseFirebaseConfigJson('{"firebaseConfig":{"apiKey":"AIzaJson","projectId":"json-app"}}')
  assert.equal(wrapped.projectId, 'json-app')
  assert.equal(wrapped.apiKey, 'AIzaJson')
  assert.equal(wrapped.databaseId, null)

  assert.throws(() => parseFirebaseConfigJson('{"apiKey":"missing-project"}'), /projectId/i)
  assert.throws(() => parseFirebaseConfigJson('not a config'), /config object/i)
})

test('Firebase environment defaults seed an empty connector without overwriting saved settings', () => {
  const defaults: FirebaseEnvConfig = {
    apiKey: 'env-key', authDomain: 'env.firebaseapp.com', projectId: 'env-project',
    storageBucket: 'env.appspot.com', messagingSenderId: '123456789', appId: '1:123456789:web:env',
    firestoreDatabaseId: 'env-db', partnersCollection: 'env-partners',
  }
  const empty: PartnerAppConfig = { mode: 'firestore', projectId: '', apiKey: '', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '', lastConnectedAt: null, lastSyncAt: null, lastError: null }
  const seeded = applyFirebaseConnectionDefaults(empty, defaults)
  assert.equal(seeded.projectId, 'env-project')
  assert.equal(seeded.apiKey, 'env-key')
  assert.equal(seeded.databaseId, 'env-db')
  assert.equal(seeded.partnersCollection, 'env-partners')

  const saved: PartnerAppConfig = { ...empty, projectId: 'saved-project', apiKey: 'saved-key', databaseId: 'saved-db', partnersCollection: 'saved-partners' }
  assert.deepEqual(applyFirebaseConnectionDefaults(saved, defaults), saved)

  const endpoint: PartnerAppConfig = { ...empty, mode: 'endpoint', endpointUrl: 'https://example.com/partners' }
  assert.deepEqual(applyFirebaseConnectionDefaults(endpoint, defaults), endpoint)
})

test('expired mandatory documents immediately block eligibility', () => {
  const frame = frameWithDemo()
  const partner = frame.data.partners.find((item) => item.id === 'DP-0187')!
  const delivery = frame.data.deliveries.find((item) => item.id === 'DLV-1046')!
  assert.equal(getPartnerEligibility(frame.data, partner, delivery).eligible, true)
  const document = frame.data.documents.find((item) => item.partnerId === partner.id && item.type === 'Driving licence')!
  const updated = apply(frame, { type: 'document.update', documentId: document.id, status: 'Expired', reason: 'Demo expiry', expiresAt: null })
  expectSuccess(updated)
  assert.equal(getPartnerEligibility(updated.data, partner, delivery).eligible, false)
  assert.match(getPartnerEligibility(updated.data, partner, delivery).reasons.join(' '), /expired/i)
})

test('notification read state and administrative changes are persisted through the local data adapter', () => {
  const frame = frameWithDemo()
  const notification = frame.data.notifications.find((item) => !item.readAt)!
  const next = apply(frame, { type: 'notification.read', notificationId: notification.id })
  expectSuccess(next)
  assert.ok(next.data.notifications.find((item) => item.id === notification.id)?.readAt)

  let stored = ''
  const fakeWindow = {
    localStorage: {
      getItem: () => stored || null,
      setItem: (_key: string, value: string) => { stored = value },
      removeItem: () => { stored = '' },
    },
  }
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true })
  try {
    // Older local records may contain a lower internal role. Persistence must
    // normalize the saved profile back to the single Administrator account.
    next.data.user.role = 'Viewer'
    assert.equal(saveOperationsState(next.data), true)
    const loaded = loadOperationsState()
    assert.equal(loaded.user.role, 'Admin')
    assert.equal(loaded.user.id, 'ADM-OPS-01')
    assert.equal(loaded.notifications.find((item) => item.id === notification.id)?.readAt, next.data.notifications.find((item) => item.id === notification.id)?.readAt)
    assert.equal(loaded.deliveries.length, next.data.deliveries.length)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('invalid settings and unauthorized administrative writes leave saved settings unchanged', () => {
  const frame = frameWithDemo()
  const invalid = apply(frame, { type: 'settings.save', settings: { ...frame.data.settings, offerTimeoutMinutes: 0 } })
  assert.equal(invalid.feedback?.kind, 'error')
  assert.equal(invalid.data.settings.offerTimeoutMinutes, frame.data.settings.offerTimeoutMinutes)
  frame.data.user.role = 'Operations Staff'
  const unauthorized = apply(frame, { type: 'settings.save', settings: { ...frame.data.settings, offerTimeoutMinutes: 9 } })
  assert.equal(unauthorized.feedback?.kind, 'error')
  assert.equal(unauthorized.data.settings.offerTimeoutMinutes, frame.data.settings.offerTimeoutMinutes)
})

test('demo reset restores interconnected seed records and records the reset event', () => {
  let frame = frameWithDemo()
  frame = apply(frame, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  frame = apply(frame, { type: 'demo.reset' })
  expectSuccess(frame)
  assert.equal(frame.data.deliveries.find((item) => item.id === 'DLV-1046')?.status, 'Unassigned')
  assert.equal(frame.data.partners.find((item) => item.id === 'DP-0187')?.availability, 'Available')
  assert.ok(frame.data.auditLogs.some((item) => item.eventType === 'Local data reset'))
})

test('live deliveries from delivery_app are normalized for the operations map', () => {
  const deliveries = normalizeLiveDeliveries({
    documents: [
      {
        name: 'projects/delivery-231a0/databases/(default)/documents/deliveries/PK-2001',
        fields: {
          displayId: { stringValue: '#PK-2001' },
          partnerUid: { stringValue: 'partner-1' },
          partnerName: { stringValue: 'Aparup Santra' },
          status: { stringValue: 'in_transit' },
          adminStatus: { stringValue: 'In Transit' },
          source: { stringValue: 'live' },
          pickup: {
            mapValue: {
              fields: {
                name: { stringValue: 'Salt Lake Hub' },
                address: { stringValue: 'Salt Lake, Kolkata' },
                latitude: { doubleValue: 22.5867 },
                longitude: { doubleValue: 88.4171 },
              },
            },
          },
          destination: {
            mapValue: {
              fields: {
                name: { stringValue: 'New Town' },
                address: { stringValue: 'New Town, Kolkata' },
                latitude: { doubleValue: 22.52 },
                longitude: { doubleValue: 88.46 },
              },
            },
          },
          distanceKm: { doubleValue: 6.4 },
          etaMinutes: { integerValue: '22' },
          earnings: { doubleValue: 95 },
          itemCount: { integerValue: '2' },
          paymentMode: { stringValue: 'Cash' },
          customerName: { stringValue: 'R. Das' },
          customerPhoneMasked: { stringValue: '+91 ***** 4321' },
          requestedAt: { stringValue: '2026-11-16T09:00:00.000Z' },
          events: {
            arrayValue: {
              values: [
                { mapValue: { fields: { status: { stringValue: 'accepted' }, at: { stringValue: '2026-11-16T09:01:00.000Z' } } } },
                { mapValue: { fields: { status: { stringValue: 'in_transit' }, at: { stringValue: '2026-11-16T09:10:00.000Z' } } } },
              ],
            },
          },
          currentLocation: {
            mapValue: {
              fields: {
                latitude: { doubleValue: 22.59 },
                longitude: { doubleValue: 88.42 },
                accuracy: { doubleValue: 12 },
                updatedAt: { stringValue: '2026-11-16T09:12:00.000Z' },
              },
            },
          },
          updatedAt: { stringValue: '2026-11-16T09:12:00.000Z' },
        },
      },
      {
        name: 'projects/delivery-231a0/databases/(default)/documents/deliveries/PK-2002',
        fields: { displayId: { stringValue: '#PK-2002' } },
      },
    ],
  })

  assert.equal(deliveries.length, 1)
  const delivery = deliveries[0]
  assert.equal(delivery.id, 'PK-2001')
  assert.equal(delivery.displayId, '#PK-2001')
  assert.equal(delivery.status, 'In Transit')
  assert.equal(delivery.nativeStatus, 'in_transit')
  assert.equal(delivery.pickup.name, 'Salt Lake Hub')
  assert.equal(delivery.destination.latitude, 22.52)
  assert.equal(delivery.etaMinutes, 22)
  assert.equal(delivery.events.length, 2)
  assert.equal(delivery.currentLocation?.updatedAt, '2026-11-16T09:12:00.000Z')
})

test('live delivery normalization tolerates missing optional fields', () => {
  const [delivery] = normalizeLiveDeliveries({
    documents: [
      {
        name: 'projects/delivery-231a0/databases/(default)/documents/deliveries/PK-2003',
        fields: {
          status: { stringValue: 'accepted' },
          pickup: { mapValue: { fields: { name: { stringValue: 'Hub' }, latitude: { doubleValue: 22.5 }, longitude: { doubleValue: 88.4 } } } },
          destination: { mapValue: { fields: { name: { stringValue: 'Drop' }, latitude: { doubleValue: 22.6 }, longitude: { doubleValue: 88.5 } } } },
        },
      },
    ],
  })

  assert.equal(delivery.displayId, '#PK-2003')
  assert.equal(delivery.status, 'accepted')
  assert.equal(delivery.partnerName, 'Delivery partner')
  assert.equal(delivery.currentLocation, null)
  assert.deepEqual(delivery.events, [])
})

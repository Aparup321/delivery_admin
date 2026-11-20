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
import type { AdminSection, PartnerAppConfig, Permission } from '../src/domain/model.ts'
import { DEFAULT_ADMIN_EMAIL, DEMO_RESTRICTED_ADMIN_EMAIL } from '../src/domain/admin.ts'
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

/** Replaces the signed-in main administrator with a restricted account. */
function restrictUser(
  frame: AppFrame,
  permissions: Permission[] = ['read'],
  sections: AdminSection[] = ['deliveries'],
) {
  frame.data.user.role = 'Restricted Administrator'
  frame.data.user.permissions = permissions
  frame.data.user.sections = sections
  frame.data.user.provisioned = true
  return frame
}

/** Re-resolves the signed-in identity through the seeded administrator directory. */
function identifyMainAdmin(frame: AppFrame) {
  return apply(frame, { type: 'user.identify', id: 'DEMO-OPS-01', name: 'Operations Administrator', email: DEFAULT_ADMIN_EMAIL })
}

test('the operations team demo exposes a main administrator with complete account details', () => {
  const state = createDemoState()
  const user = state.user
  assert.equal(user.role, 'Main Administrator')
  assert.equal(user.id, 'ADM-OPS-01')
  assert.equal(user.name, 'Operations Administrator')
  assert.equal(user.email, DEFAULT_ADMIN_EMAIL)
  assert.equal(user.title, 'Delivery Operations Administrator')
  assert.equal(user.maskedPhone, 'Not provided')
  assert.equal(user.provisioned, true)
  assert.equal(state.admins.filter((account) => account.role === 'Main Administrator').length, 1)
  assert.equal(state.admins.filter((account) => account.role === 'Restricted Administrator').length, 1)
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
    assert.equal(demo?.userId, 'DEMO-OPS-01')
    assert.deepEqual(readAdminSession(), demo)
    assert.equal(clearAdminSession(), true)
    assert.equal(readDemoAdminSession(), null)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('the signed-in Firebase identity resolves its access from the administrator directory', () => {
  const frame = frameWithDemo()
  const identified = apply(frame, { type: 'user.identify', id: 'firebase-uid-1', name: 'Ops Lead', email: DEFAULT_ADMIN_EMAIL })
  assert.equal(identified.data.user.id, 'firebase-uid-1')
  assert.equal(identified.data.user.name, 'Operations Administrator')
  assert.equal(identified.data.user.email, DEFAULT_ADMIN_EMAIL)
  assert.equal(identified.data.user.role, 'Main Administrator')
  assert.equal(identified.data.user.provisioned, true)
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

test('the shared action layer rejects writes for a restricted viewer and resolves a main administrator from the directory', () => {
  const frame = restrictUser(frameWithDemo())
  const blocked = apply(frame, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.deliveries.find((item) => item.id === 'DLV-1046')?.status, 'Unassigned')

  const resolved = identifyMainAdmin(blocked)
  expectSuccess(resolved)
  assert.equal(resolved.data.user.role, 'Main Administrator')
  const assigned = apply(resolved, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  expectSuccess(assigned)
})

test('an email without an active directory record is denied every administrative action', () => {
  const identified = apply(frameWithDemo(), { type: 'user.identify', id: 'firebase-unknown', name: 'Unknown Operator', email: 'unknown@example.com' })
  assert.equal(identified.data.user.provisioned, false)
  assert.equal(identified.data.user.role, 'Restricted Administrator')
  assert.deepEqual(identified.data.user.permissions, [])
  const blocked = apply(identified, { type: 'delivery.assign', deliveryId: 'DLV-1046', partnerId: 'DP-0187' })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.match(blocked.feedback?.message ?? '', /cannot perform/i)
})

test('a restricted administrator only receives the directory sections and actions, and deactivation revokes sign-in', () => {
  const restricted = apply(frameWithDemo(), { type: 'user.identify', id: 'demo-dispatch', name: 'Demo Dispatch Coordinator', email: DEMO_RESTRICTED_ADMIN_EMAIL })
  assert.equal(restricted.data.user.role, 'Restricted Administrator')
  assert.equal(restricted.data.user.provisioned, true)
  assert.deepEqual(restricted.data.user.sections, ['deliveries', 'partners'])
  assert.deepEqual(restricted.data.user.permissions, ['read', 'assignment', 'delivery-management', 'partner-management', 'document-review'])

  const blockedApproval = apply(restricted, { type: 'application.approve', applicationId: 'APP-2041', note: '' })
  assert.equal(blockedApproval.feedback?.kind, 'error')
  const blockedAdminCreate = apply(restricted, { type: 'admin.create', name: 'Shadow Admin', email: 'shadow@picdrop.demo', title: '', role: 'Restricted Administrator', sections: [], permissions: [] })
  assert.equal(blockedAdminCreate.feedback?.kind, 'error')

  const main = identifyMainAdmin(blockedAdminCreate)
  const account = main.data.admins.find((item) => item.email === DEMO_RESTRICTED_ADMIN_EMAIL)!
  const deactivated = apply(main, { type: 'admin.set-active', adminId: account.id, active: false, reason: 'Access review' })
  expectSuccess(deactivated)
  assert.ok(deactivated.data.auditLogs.some((item) => item.eventType === 'Administrator deactivated' && item.targetId === account.id))

  const revoked = apply(deactivated, { type: 'user.identify', id: 'demo-dispatch', name: 'Demo Dispatch Coordinator', email: DEMO_RESTRICTED_ADMIN_EMAIL })
  assert.equal(revoked.data.user.provisioned, false)
  assert.deepEqual(revoked.data.user.permissions, [])
})

test('main administrators can create restricted accounts without delegating onboarding or administrator access', () => {
  const created = apply(frameWithDemo(), {
    type: 'admin.create', name: 'Rita Das', email: 'Rita.Das@Example.com', title: 'KYC Reviewer',
    role: 'Restricted Administrator', sections: ['partners'], permissions: ['read', 'application-review', 'admin', 'document-review'],
  })
  expectSuccess(created)
  const account = created.data.admins.find((item) => item.email === 'rita.das@example.com')!
  assert.equal(account.active, true)
  assert.equal(account.role, 'Restricted Administrator')
  assert.deepEqual(account.sections, ['partners'])
  assert.deepEqual(account.permissions, ['read', 'document-review'])
  assert.ok(created.data.auditLogs.some((item) => item.eventType === 'Administrator created' && item.targetId === account.id))

  const duplicate = apply(created, {
    type: 'admin.create', name: 'Rita Duplicate', email: 'rita.das@example.com', title: '', role: 'Restricted Administrator', sections: [], permissions: [],
  })
  assert.equal(duplicate.feedback?.kind, 'error')
  assert.match(duplicate.feedback?.message ?? '', /already/i)
})

test('the administrator directory enforces the two-main-administrator limit', () => {
  const withSecond = apply(frameWithDemo(), {
    type: 'admin.create', name: 'Second Main', email: 'second@picdrop.demo', title: 'Operations Lead',
    role: 'Main Administrator', sections: [], permissions: [],
  })
  expectSuccess(withSecond)
  assert.equal(withSecond.data.admins.filter((item) => item.active && item.role === 'Main Administrator').length, 2)

  const second = withSecond.data.admins.find((item) => item.email === 'second@picdrop.demo')!
  assert.deepEqual(second.sections, ['deliveries', 'partners', 'audit-logs', 'settings'])

  const third = apply(withSecond, {
    type: 'admin.create', name: 'Third Main', email: 'third@picdrop.demo', title: 'Operations Lead',
    role: 'Main Administrator', sections: [], permissions: [],
  })
  assert.equal(third.feedback?.kind, 'error')
  assert.match(third.feedback?.message ?? '', /only two/i)

  const downgraded = apply(withSecond, {
    type: 'admin.update', adminId: second.id, name: second.name, title: second.title,
    role: 'Restricted Administrator', sections: ['partners'], permissions: ['read', 'partner-management'],
  })
  expectSuccess(downgraded)
  assert.equal(downgraded.data.admins.filter((item) => item.active && item.role === 'Main Administrator').length, 1)

  const thirdAllowed = apply(downgraded, {
    type: 'admin.create', name: 'Third Main', email: 'third@picdrop.demo', title: 'Operations Lead',
    role: 'Main Administrator', sections: [], permissions: [],
  })
  expectSuccess(thirdAllowed)
  assert.equal(thirdAllowed.data.admins.filter((item) => item.active && item.role === 'Main Administrator').length, 2)
})

test('the administrator directory always keeps one active main administrator', () => {
  const frame = frameWithDemo()
  const main = frame.data.admins.find((item) => item.role === 'Main Administrator')!
  const downgraded = apply(frame, {
    type: 'admin.update', adminId: main.id, name: main.name, title: main.title,
    role: 'Restricted Administrator', sections: ['deliveries'], permissions: ['read'],
  })
  assert.equal(downgraded.feedback?.kind, 'error')
  assert.match(downgraded.feedback?.message ?? '', /at least one/i)
  assert.equal(downgraded.data.admins.find((item) => item.id === main.id)?.role, 'Main Administrator')

  const deactivated = apply(frame, { type: 'admin.set-active', adminId: main.id, active: false, reason: 'Access review' })
  assert.equal(deactivated.feedback?.kind, 'error')
  assert.equal(deactivated.data.admins.find((item) => item.id === main.id)?.active, true)
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

test('partner suspension stores an administrator-selected timeline and expires automatically', () => {
  const frame = frameWithDemo()
  const suspended = apply(frame, {
    type: 'partner.restrict',
    partnerId: 'DP-0192',
    status: 'Suspended',
    durationDays: 3,
    reason: 'Temporary compliance review',
  })
  expectSuccess(suspended)
  const partner = suspended.data.partners.find((item) => item.id === 'DP-0192')!
  assert.equal(partner.suspensionDays, 3)
  assert.ok(partner.suspendedUntil)
  assert.match(suspended.data.partnerHistory.find((item) => item.partnerId === partner.id && item.type === 'Suspended')?.description ?? '', /3 days/)

  const beforeExpiry = apply(suspended, { type: 'partner.expire-suspensions', now: new Date(partner.suspendedUntil!).getTime() - 1 })
  assert.equal(beforeExpiry.data.partners.find((item) => item.id === partner.id)?.availability, 'Suspended')
  const expired = apply(beforeExpiry, { type: 'partner.expire-suspensions', now: new Date(partner.suspendedUntil!).getTime() })
  expectSuccess(expired)
  const restored = expired.data.partners.find((item) => item.id === partner.id)!
  assert.equal(restored.availability, 'On Delivery')
  assert.equal(restored.suspendedUntil, null)
  assert.equal(restored.suspensionDays, null)
  assert.ok(expired.data.auditLogs.some((item) => item.eventType === 'Partner suspension expired' && item.targetId === partner.id))
})

test('only a main administrator can approve an onboarding application, which onboards the partner and queues KYC documents', () => {
  const frame = restrictUser(frameWithDemo(), ['read', 'document-review'], ['partners'])
  const blocked = apply(frame, { type: 'application.approve', applicationId: 'APP-2041', note: '' })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.applications.find((item) => item.id === 'APP-2041')?.status, 'Submitted')
  const blockedRejection = apply(blocked, { type: 'application.reject', applicationId: 'APP-2041', reason: 'Not eligible' })
  assert.equal(blockedRejection.feedback?.kind, 'error')
  assert.equal(blockedRejection.data.applications.find((item) => item.id === 'APP-2041')?.status, 'Submitted')

  const approved = apply(identifyMainAdmin(blocked), { type: 'application.approve', applicationId: 'APP-2041', note: 'Demo onboarding approval' })
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

test('approved live partners become available only when the partner app reports online', () => {
  const frame = frameWithDemo()
  const synced = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'live-approved-uid', partnerId: 'live-approved-uid', name: 'Live Approved Partner', phone: '+91 90000 12345',
      email: 'live@example.com', vehicle: 'Bike', status: 'active', applicationStatus: 'submitted', isOnline: true,
      serviceAreas: ['New Town'], updatedAt: '2026-06-01T09:55:00.000Z', fields: { fullName: 'Live Approved Partner' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  const reviewed = apply(synced, { type: 'partnerApp.review', recordId: 'live-approved-uid', decision: 'Approved', note: '' })
  expectSuccess(reviewed)
  const application = reviewed.data.applications.find((item) => item.partnerAppUid === 'live-approved-uid')!
  const written = apply(reviewed, { type: 'partnerApp.write-result', targetType: 'Application', targetId: application.id, recordId: 'live-approved-uid', ok: true, message: 'approved', at: '2026-06-01T10:01:00.000Z', applicationStatus: 'approved', accountStatus: 'active' })
  const partner = written.data.partners.find((item) => item.partnerAppUid === 'live-approved-uid')!
  assert.equal(partner.availability, 'Available')
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

test('a main administrator can create a partner directory record with missing mandatory documents', () => {
  const frame = frameWithDemo()
  const partnerId = nextPartnerId(frame.data)
  assert.match(partnerId, /^DP-\d{4}$/)
  assert.equal(Number(partnerId.slice(3)), Math.max(...frame.data.partners.map((partner) => Number(partner.id.slice(3)))) + 1)

  const blocked = apply(restrictUser(frame), {
    type: 'partner.create', partnerId, name: 'Sneha Bose', phone: '+91 98765 43210', email: 'sneha@example.com',
    vehicle: 'Scooter', serviceAreas: ['Barasat'], registrationLast4: '1234', note: '',
  })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.partners.some((partner) => partner.id === partnerId), false)

  const created = apply(identifyMainAdmin(blocked), {
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

test('partner app connection requires settings access, validates manual details, and caches synced records', () => {
  const frame = restrictUser(frameWithDemo())
  const blocked = apply(frame, { type: 'partnerApp.save', config: { mode: 'firestore', projectId: 'delivery-app-demo', apiKey: '', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '' } })
  assert.equal(blocked.feedback?.kind, 'error')

  const settingsFrame = identifyMainAdmin(blocked)
  const invalidProject = apply(settingsFrame, { type: 'partnerApp.save', config: { mode: 'firestore', projectId: ' ', apiKey: '', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '' } })
  assert.equal(invalidProject.feedback?.kind, 'error')
  const invalidEndpoint = apply(settingsFrame, { type: 'partnerApp.save', config: { mode: 'endpoint', projectId: '', apiKey: '', databaseId: '(default)', partnersCollection: '', endpointUrl: 'ftp://example.com/partners' } })
  assert.equal(invalidEndpoint.feedback?.kind, 'error')

  const saved = apply(settingsFrame, { type: 'partnerApp.save', config: { mode: 'firestore', projectId: 'delivery-app-demo', apiKey: 'demo-key', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '' } })
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

test('a restricted partner administrator can sync and link records without changing connection settings', () => {
  const frame = restrictUser(frameWithDemo(), ['read', 'partner-management'], ['partners'])
  const synced = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-05-01T10:00:00.000Z',
    records: [{
      id: 'restricted-sync-record', partnerId: null, name: 'Restricted Sync Partner', phone: '+91 81111 22222', email: null,
      vehicle: 'Scooter', status: 'Online', serviceAreas: ['Barasat'], updatedAt: '2026-05-01T09:55:00.000Z',
      fields: { name: 'Restricted Sync Partner' }, syncedAt: '2026-05-01T10:00:00.000Z',
    }],
  })
  expectSuccess(synced)
  assert.equal(synced.data.partnerAppRecords.length, 1)

  const linked = apply(synced, { type: 'partnerApp.link', recordId: 'restricted-sync-record', partnerId: 'DP-0192' })
  expectSuccess(linked)
  assert.equal(linked.data.partners.find((partner) => partner.id === 'DP-0192')?.partnerAppUid, 'restricted-sync-record')

  const blockedSave = apply(linked, {
    type: 'partnerApp.save',
    config: { mode: 'firestore', projectId: 'delivery-app-demo', apiKey: 'demo-key', databaseId: '(default)', partnersCollection: 'partners', endpointUrl: '' },
  })
  assert.equal(blockedSave.feedback?.kind, 'error')
})

test('a newly synced delivery_app support ticket creates one unread admin notification', () => {
  const frame = frameWithDemo()
  const synced = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-06-02T10:00:00.000Z',
    records: [],
    tickets: [{
      id: 'ticket-1001',
      partnerUid: 'delivery-app-user-1001',
      subject: 'Unable to go online',
      message: 'The app says my account is paused.',
      status: 'Open',
      createdAt: '2026-06-02T09:59:00.000Z',
      updatedAt: null,
      syncedAt: '2026-06-02T10:00:00.000Z',
    }],
  })
  expectSuccess(synced)
  const ticketNotification = synced.data.notifications.find((item) => item.category === 'Partner Support Ticket')
  assert.ok(ticketNotification)
  assert.equal(ticketNotification?.readAt, null)
  assert.equal(ticketNotification?.relatedRecordId, 'ticket-1001')
  assert.match(ticketNotification?.title ?? '', /Unable to go online/)

  const repeated = apply(synced, {
    type: 'partnerApp.sync-result',
    at: '2026-06-02T10:01:00.000Z',
    records: [],
    tickets: synced.data.partnerAppTickets,
  })
  assert.equal(repeated.data.notifications.filter((item) => item.relatedRecordId === 'ticket-1001').length, 1)
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
  restrictUser(records, ['read', 'partner-management'], ['partners'])

  const blocked = apply(records, { type: 'partnerApp.review', recordId: 'live-partner-uid', decision: 'Approved', note: '' })
  assert.equal(blocked.feedback?.kind, 'error')
  assert.equal(blocked.data.applications.some((item) => item.partnerAppUid === 'live-partner-uid'), false)

  const mainAdmin = identifyMainAdmin(blocked)
  const rejectedWithoutReason = apply(mainAdmin, { type: 'partnerApp.review', recordId: 'live-partner-uid', decision: 'Rejected', note: ' ' })
  assert.equal(rejectedWithoutReason.feedback?.kind, 'error')

  const approved = apply(mainAdmin, { type: 'partnerApp.review', recordId: 'live-partner-uid', decision: 'Approved', note: 'Checked in delivery_app' })
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

test('assigning a linked partner builds a delivery offer write for delivery_app', () => {
  let frame = frameWithDemo()
  // Link the demo partner to a delivery_app Firebase UID first.
  const synced = apply(frame, {
    type: 'partnerApp.sync-result',
    at: '2026-06-01T10:00:00.000Z',
    records: [{
      id: 'live-assignee-uid', partnerId: null, name: 'Sayan M.', phone: '+91 90000 04748',
      email: null, vehicle: 'Scooter', status: 'active', applicationStatus: 'approved',
      serviceAreas: ['New Town', 'Bidhannagar', 'Rajarhat'], updatedAt: '2026-06-01T09:55:00.000Z',
      fields: { phone: '+91 90000 04748' }, syncedAt: '2026-06-01T10:00:00.000Z',
    }],
  })
  expectSuccess(synced)
  frame = identifyMainAdmin(synced)
  const approved = apply(frame, { type: 'partnerApp.review', recordId: 'live-assignee-uid', decision: 'Approved', note: 'Approved for the assignment test' })
  expectSuccess(approved)

  const assigned = apply(approved, { type: 'delivery.create', pickup: 'New Town', drop: 'Salt Lake', packageSize: 'Small', weight: 1.5, vehicle: 'Any', scheduledStart: '2026-06-01T11:00:00.000Z', scheduledEnd: '2026-06-01T12:00:00.000Z', instructions: 'Ring the bell twice', category: 'Grocery', itemCount: 3, paymentMode: 'Prepaid', earnings: 90 })
  expectSuccess(assigned)
  const createdId = assigned.data.deliveries[0].id
  assert.equal(assigned.data.deliveries[0].category, 'Grocery')
  assert.equal(assigned.data.deliveries[0].itemCount, 3)
  assert.equal(assigned.data.deliveries[0].partnerEarnings, 90)

  frame = apply(assigned, { type: 'delivery.assign', deliveryId: createdId, partnerId: approved.data.applications.find((item) => item.partnerAppUid === 'live-assignee-uid')!.partnerId! })
  expectSuccess(frame)
  const assignment = frame.data.assignments.find((item) => item.deliveryId === createdId)!
  assert.ok(assignment.dropOtp)
  assert.match(assignment.dropOtp, /^\d{4}$/)
  const assignLog = frame.data.auditLogs.find((item) => item.eventType === 'Delivery assigned' && item.targetId === createdId)!
  const intent = buildPartnerAppWriteIntent(frame.data, assignLog)
  assert.equal(intent?.kind, 'delivery-assignment')
  if (intent?.kind === 'delivery-assignment') {
    assert.equal(intent.partnerAppUid, 'live-assignee-uid')
    assert.equal(intent.deliveryId, createdId)
    assert.equal(intent.category, 'Grocery')
    assert.equal(intent.itemCount, 3)
    assert.equal(intent.paymentMode, 'Prepaid')
    assert.equal(intent.earnings, 90)
    assert.equal(intent.note, 'Ring the bell twice')
    assert.ok(intent.expiresAt > intent.requestedAt)
    assert.ok(intent.distanceKm > 0)
  }

  const cancelled = apply(frame, { type: 'delivery.cancel', deliveryId: createdId, reason: 'Customer changed the window' })
  expectSuccess(cancelled)
  const cancelLog = cancelled.data.auditLogs.find((item) => item.eventType === 'Delivery cancelled' && item.targetId === createdId)!
  const cancelIntent = buildPartnerAppWriteIntent(cancelled.data, cancelLog)
  assert.equal(cancelIntent?.kind, 'delivery-cancel')
  if (cancelIntent?.kind === 'delivery-cancel') {
    assert.equal(cancelIntent.partnerAppUid, 'live-assignee-uid')
    assert.equal(cancelIntent.reason, 'Customer changed the window')
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
    // Local storage never grants access: the saved profile is normalized back
    // to the default main administrator until sign-in resolves the directory.
    next.data.user.role = 'Restricted Administrator'
    next.data.user.permissions = []
    assert.equal(saveOperationsState(next.data), true)
    const loaded = loadOperationsState()
    assert.equal(loaded.user.role, 'Main Administrator')
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
  restrictUser(frame, ['read'], ['deliveries'])
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
  assert.equal(frame.data.admins.length, 2)
  assert.equal(frame.data.user.role, 'Main Administrator')
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

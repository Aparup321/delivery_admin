import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoState } from '../src/domain/seed.ts'
import { getPartnerEligibility } from '../src/domain/operations.ts'
import { appReducer, type AppFrame, type OperationAction } from '../src/state/operationsReducer.ts'
import { loadOperationsState, saveOperationsState } from '../src/data/persistence.ts'
import { normalizePartnerAppRecords, parseFirebaseConfigJson, partnerAppEndpoint } from '../src/services/partnerApp.ts'
import { buildPartnerAppWriteIntent } from '../src/services/partnerAppIntent.ts'
import { applyFirebaseConnectionDefaults, type FirebaseEnvConfig } from '../src/config/firebase.ts'
import type { PartnerAppConfig } from '../src/domain/model.ts'
import { DEMO_ADMIN_EMAIL } from '../src/domain/admin.ts'
import { DEMO_ADMIN_PASSWORD, clearAdminSession, createAdminSession, persistAdminSession, readAdminSession, validateDemoAdminCredentials } from '../src/auth/adminSession.ts'
import { DEMO_OTP_CODE, createDemoOtpChallenge, verifyOtp } from '../src/services/otp.ts'

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
  assert.equal(user.name, 'Operations Admin')
  assert.equal(user.email, DEMO_ADMIN_EMAIL)
  assert.equal(user.title, 'Delivery Operations Administrator')
  assert.match(user.maskedPhone, /•/)
})

test('Administrator demo sign-in validates credentials and persists a restorable local session', () => {
  assert.equal(validateDemoAdminCredentials(DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD), true)
  assert.equal(validateDemoAdminCredentials(`  ${DEMO_ADMIN_EMAIL.toUpperCase()} `, DEMO_ADMIN_PASSWORD), true)
  assert.equal(validateDemoAdminCredentials(DEMO_ADMIN_EMAIL, 'incorrect-password'), false)
  assert.equal(validateDemoAdminCredentials('someone@picdrop.demo', DEMO_ADMIN_PASSWORD), false)

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
    const session = createAdminSession('2026-05-01T09:30:00.000Z')
    assert.equal(session.role, 'Admin')
    assert.equal(session.email, DEMO_ADMIN_EMAIL)
    assert.equal(persistAdminSession(session), true)
    assert.deepEqual(readAdminSession(), session)
    assert.equal(clearAdminSession(), true)
    assert.equal(readAdminSession(), null)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('demo OTP accepts only the displayed code and expires after five minutes', () => {
  const issuedAt = Date.UTC(2026, 4, 1, 9, 0, 0)
  const challenge = createDemoOtpChallenge(DEMO_ADMIN_EMAIL, issuedAt)
  assert.equal(challenge.destination, DEMO_ADMIN_EMAIL)
  assert.equal(challenge.code, DEMO_OTP_CODE)
  assert.equal(challenge.expiresAt, new Date(issuedAt + 5 * 60_000).toISOString())
  assert.deepEqual(verifyOtp(challenge, DEMO_OTP_CODE, issuedAt + 60_000), { ok: true })
  assert.deepEqual(verifyOtp(challenge, ' 123456 ', issuedAt + 60_000), { ok: true })
  assert.deepEqual(verifyOtp(challenge, '000000', issuedAt + 60_000), { ok: false, reason: 'invalid' })
  assert.deepEqual(verifyOtp(challenge, DEMO_OTP_CODE, issuedAt + 5 * 60_000), { ok: false, reason: 'expired' })
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
  assert.equal(suspensionEvent.actor, 'Operations Admin')
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
  assert.ok(frame.data.auditLogs.some((item) => item.eventType === 'Demo data reset'))
})

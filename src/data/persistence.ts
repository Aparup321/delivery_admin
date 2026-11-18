import { applyFirebaseConnectionDefaults } from '../config/firebase.ts'
import type { OperationsState } from '../domain/model'
import { createDemoState, DEMO_PARTNER_PHONES } from '../domain/seed.ts'

const STORAGE_KEY = 'picdrop-hopngo-operations-demo-v3'

function isOperationsState(value: unknown): value is OperationsState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OperationsState>
  return candidate.schemaVersion === 3
    && Array.isArray(candidate.deliveries)
    && Array.isArray(candidate.partners)
    && Array.isArray(candidate.applications)
    && Boolean(candidate.partnerApp)
    && Array.isArray(candidate.partnerAppRecords)
    && Array.isArray(candidate.documents)
    && Array.isArray(candidate.assignments)
    && Array.isArray(candidate.offers)
    && Array.isArray(candidate.notifications)
    && Array.isArray(candidate.auditLogs)
    && Boolean(candidate.user)
    && Boolean(candidate.settings)
}

function linkedRecordId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeSavedState(parsed: OperationsState): OperationsState {
  // Older local records predate the delivery_app link fields. Normalize them
  // so every partner, application, and cached record has a stable shape.
  return {
    ...parsed,
    // The console exposes one Administrator role. The signed-in Firebase
    // identity supplies the display fields; local storage cannot grant another role.
    user: { ...parsed.user, role: 'Admin' },
    partnerApp: applyFirebaseConnectionDefaults(parsed.partnerApp),
    partners: parsed.partners.map((partner) => ({
      ...partner,
      demoPhone: typeof partner.demoPhone === 'string' ? partner.demoPhone : DEMO_PARTNER_PHONES[partner.id] ?? null,
      partnerAppUid: linkedRecordId(partner.partnerAppUid),
    })),
    applications: parsed.applications.map((application) => ({
      ...application,
      partnerAppUid: linkedRecordId(application.partnerAppUid),
    })),
    partnerAppRecords: parsed.partnerAppRecords.map((record) => ({
      ...record,
      applicationStatus: typeof record.applicationStatus === 'string' ? record.applicationStatus : null,
    })),
  }
}

export function loadOperationsState(): OperationsState {
  if (typeof window === 'undefined') return createDemoState()
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return createDemoState()
    const parsed: unknown = JSON.parse(saved)
    // Normalize older local records and seed an empty Firestore connector from
    // the environment values. The authenticated Firebase identity is applied by
    // the app shell after sign-in; local records never grant a different role.
    return isOperationsState(parsed) ? normalizeSavedState(parsed) : createDemoState()
  } catch {
    return createDemoState()
  }
}

export function saveOperationsState(state: OperationsState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearOperationsState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

import { createDemoAdmin } from '../domain/admin.ts'
import type { OperationsState } from '../domain/model'
import { createDemoState } from '../domain/seed.ts'

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

export function loadOperationsState(): OperationsState {
  if (typeof window === 'undefined') return createDemoState()
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return createDemoState()
    const parsed: unknown = JSON.parse(saved)
    // The Operations team demo only exposes one Administrator account. Normalize
    // older local records so a saved persona can never grant a lower role.
    return isOperationsState(parsed) ? { ...parsed, user: createDemoAdmin() } : createDemoState()
  } catch {
    return createDemoState()
  }
}

export function saveOperationsState(state: OperationsState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, user: createDemoAdmin() }))
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

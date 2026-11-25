import type { OperationsState } from '../domain/model.ts'
import { isRecord, PartnerAppRequestError, partnerAppCollectionDocumentEndpoint } from './partnerApp.ts'
import { encodeValue } from './partnerAppWrite.ts'
import { resolvePartnerAppToken } from './firebaseAuth.ts'

const COLLECTION = 'admin_state'
const DOCUMENT = 'operations'
const META_KEY = 'picdrop-admin-shared-workflow-meta-v1'
const DEMO_LOCAL_KEY = 'picdrop-admin-demo-workflow-hash-v1'

/**
 * A demo session writes its workflow to localStorage like a real session. If
 * the same browser later signs in with Firebase, those demo leftovers must not
 * be mistaken for unsaved administrator work and pushed over Firestore.
 *
 * The marker stores the exact shared-payload hash, so real edits made after the
 * demo session no longer match and are still allowed to win.
 */
export function markDemoLocalWorkflow(payloadHash: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DEMO_LOCAL_KEY, payloadHash)
  } catch {
    // The guard is best-effort when storage is unavailable.
  }
}

export function hasDemoLocalWorkflow(payloadHash: string) {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DEMO_LOCAL_KEY) === payloadHash
  } catch {
    return false
  }
}

export function clearDemoLocalWorkflow() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DEMO_LOCAL_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export interface SharedWorkflowMeta {
  revision: number
  payloadHash: string
  savedAt: string
}

export interface SharedWorkflowPayload {
  schemaVersion: 3
  deliveries: OperationsState['deliveries']
  partners: OperationsState['partners']
  applications: OperationsState['applications']
  documents: OperationsState['documents']
  assignments: OperationsState['assignments']
  offers: OperationsState['offers']
  partnerHistory: OperationsState['partnerHistory']
  notifications: OperationsState['notifications']
  auditLogs: OperationsState['auditLogs']
  admins: OperationsState['admins']
  settings: OperationsState['settings']
}

export interface SharedWorkflowDocument {
  state: OperationsState
  revision: number
  updatedAt: string
  updatedBy: string
}

/** Everything that must be shared by every administrator. */
export function toSharedPayload(state: OperationsState): SharedWorkflowPayload {
  return {
    schemaVersion: 3,
    deliveries: state.deliveries,
    partners: state.partners,
    applications: state.applications,
    documents: state.documents,
    assignments: state.assignments,
    offers: state.offers,
    partnerHistory: state.partnerHistory,
    notifications: state.notifications,
    auditLogs: state.auditLogs,
    admins: state.admins,
    settings: state.settings,
  }
}

/** Applies shared workflow data without replacing the local identity or live caches. */
export function mergeSharedPayload(current: OperationsState, payload: Partial<SharedWorkflowPayload>): OperationsState {
  return {
    ...current,
    deliveries: Array.isArray(payload.deliveries) ? payload.deliveries : current.deliveries,
    partners: Array.isArray(payload.partners) ? payload.partners : current.partners,
    applications: Array.isArray(payload.applications) ? payload.applications : current.applications,
    documents: Array.isArray(payload.documents) ? payload.documents : current.documents,
    assignments: Array.isArray(payload.assignments) ? payload.assignments : current.assignments,
    offers: Array.isArray(payload.offers) ? payload.offers : current.offers,
    partnerHistory: Array.isArray(payload.partnerHistory) ? payload.partnerHistory : current.partnerHistory,
    notifications: Array.isArray(payload.notifications) ? payload.notifications : current.notifications,
    auditLogs: Array.isArray(payload.auditLogs) ? payload.auditLogs : current.auditLogs,
    admins: Array.isArray(payload.admins) ? payload.admins : current.admins,
    settings: isRecord(payload.settings) ? payload.settings as OperationsState['settings'] : current.settings,
  }
}

function decodeInteger(value: unknown, fallback = 0) {
  if (isRecord(value) && typeof value.integerValue === 'string') return Number(value.integerValue)
  if (isRecord(value) && typeof value.doubleValue === 'number') return value.doubleValue
  return fallback
}

function decodeString(value: unknown) {
  return isRecord(value) && typeof value.stringValue === 'string' ? value.stringValue : ''
}

async function readDocument(config: OperationsState['partnerApp'], token: string) {
  const url = partnerAppCollectionDocumentEndpoint(config, COLLECTION, DOCUMENT)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const accessToken = await resolvePartnerAppToken(token, config.apiKey)
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(url, { headers, cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new PartnerAppRequestError(`Shared workflow state could not be loaded (HTTP ${response.status}).`, url)
  const body: unknown = await response.json()
  if (!isRecord(body) || !isRecord(body.fields)) throw new PartnerAppRequestError('Shared workflow state was not valid.', url)
  const payloadText = decodeString(body.fields.payload)
  if (!payloadText) return null
  let state: Partial<SharedWorkflowPayload>
  try {
    state = JSON.parse(payloadText) as Partial<SharedWorkflowPayload>
  } catch {
    throw new PartnerAppRequestError('Shared workflow state could not be parsed.', url)
  }
  return {
    state,
    revision: decodeInteger(body.fields.revision, 0),
    updatedAt: decodeString(body.fields.updatedAt),
    updatedBy: decodeString(body.fields.updatedBy),
  }
}

export async function loadSharedWorkflow(config: OperationsState['partnerApp'], token: string, current: OperationsState): Promise<SharedWorkflowDocument | null> {
  const document = await readDocument(config, token)
  if (!document) return null
  return {
    state: mergeSharedPayload(current, document.state),
    revision: document.revision,
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
  }
}

/** Small non-cryptographic hash used only to detect local unsaved changes. */
export function hashSharedPayload(payload: string) {
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function readSharedWorkflowMeta(): SharedWorkflowMeta | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(META_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.payloadHash !== 'string' || typeof parsed.savedAt !== 'string' || typeof parsed.revision !== 'number') return null
    return { revision: parsed.revision, payloadHash: parsed.payloadHash, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export function writeSharedWorkflowMeta(meta: SharedWorkflowMeta) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // Metadata is a reconciliation hint; the Firestore document remains authoritative.
  }
}

export async function saveSharedWorkflow(
  config: OperationsState['partnerApp'],
  token: string,
  state: OperationsState,
  updatedBy: string,
  keepalive = false,
): Promise<number> {
  const payload = JSON.stringify(toSharedPayload(state))
  if (new Blob([payload]).size > 900_000) {
    throw new Error('Shared workflow state is too large for one Firestore document. Archive older audit history before continuing.')
  }
  const url = partnerAppCollectionDocumentEndpoint(config, COLLECTION, DOCUMENT)
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
  const accessToken = await resolvePartnerAppToken(token, config.apiKey)
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const revision = Date.now()
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    keepalive,
    body: JSON.stringify({
      fields: {
        payload: encodeValue(payload),
        revision: encodeValue(revision),
        updatedAt: encodeValue(new Date().toISOString()),
        updatedBy: encodeValue(updatedBy),
      },
    }),
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') detail = `: ${body.error.message}`
    } catch {
      // The error response had no JSON body.
    }
    throw new PartnerAppRequestError(`Shared workflow state could not be saved (HTTP ${response.status})${detail}.`, url)
  }
  return revision
}

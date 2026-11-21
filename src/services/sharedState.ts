import type { OperationsState } from '../domain/model.ts'
import { isRecord, PartnerAppRequestError, partnerAppCollectionDocumentEndpoint } from './partnerApp.ts'
import { encodeValue } from './partnerAppWrite.ts'
import { resolvePartnerAppToken } from './firebaseAuth.ts'

const COLLECTION = 'admin_state'
const DOCUMENT = 'operations'

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

export async function saveSharedWorkflow(
  config: OperationsState['partnerApp'],
  token: string,
  state: OperationsState,
  updatedBy: string,
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

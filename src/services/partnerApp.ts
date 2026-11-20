import type { PartnerAppConfig, PartnerAppRecord, PartnerAppTicket } from '../domain/model.ts'
import { resolvePartnerAppToken } from './firebaseAuth.ts'

const TOKEN_KEY = 'picdrop-partner-app-token'

export function readPartnerAppToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function storePartnerAppToken(token: string) {
  try {
    if (token.trim()) window.sessionStorage.setItem(TOKEN_KEY, token.trim())
    else window.sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // The connection still works for this page view when session storage is unavailable.
  }
}

export function clearPartnerAppToken() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to clear when session storage is unavailable.
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export interface ParsedFirebaseConfig {
  projectId: string
  apiKey: string
  databaseId: string | null
}

function readConfigString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const match = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
    if (!match) continue
    const value = source[match]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** Accepts both strict JSON and the JavaScript object copied from the Firebase console. */
export function parseFirebaseConfigJson(text: string): ParsedFirebaseConfig {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Paste the Firebase config object first.')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('No config object found. Paste the full firebaseConfig object from the delivery_app web app.')
  const objectText = trimmed.slice(start, end + 1)
  let source: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(objectText)
    if (isRecord(parsed)) {
      source = isRecord(parsed.firebaseConfig) ? parsed.firebaseConfig : isRecord(parsed.config) ? parsed.config : parsed
    }
  } catch {
    // The Firebase console also copies a JavaScript object with unquoted keys; fall back to pair extraction below.
  }
  if (!source) {
    const pairs: Record<string, string> = {}
    const pattern = /["']?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*(?:"([^"]*)"|'([^']*)')/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(objectText)) !== null) pairs[match[1]] = match[2] ?? match[3] ?? ''
    source = pairs
  }
  const projectId = readConfigString(source, ['projectId', 'project_id', 'projectID'])
  if (!projectId) throw new Error('The config does not include a projectId. Copy the full firebaseConfig object from Firebase.')
  return {
    projectId,
    apiKey: readConfigString(source, ['apiKey', 'api_key']) ?? '',
    databaseId: readConfigString(source, ['firestoreDatabaseId', 'databaseId', 'firestore_database_id']),
  }
}

export class PartnerAppRequestError extends Error {
  readonly requestUrl: string
  constructor(message: string, requestUrl: string) {
    super(message)
    this.name = 'PartnerAppRequestError'
    this.requestUrl = requestUrl
  }
}

function firestoreCollection(config: PartnerAppConfig, collectionOverride?: string) {
  const projectId = config.projectId.trim()
  if (!projectId) throw new Error('Enter the Firebase project ID for the partner app.')
  const databaseId = config.databaseId.trim() || '(default)'
  const collection = (collectionOverride ?? config.partnersCollection).trim().replace(/^\/+|\/+$/g, '')
  if (!collection) throw new Error('Enter the Firestore collection that stores partners.')
  return { projectId, databaseId, collection }
}

function firestoreCollectionUrl(config: PartnerAppConfig, collectionOverride?: string) {
  const { projectId, databaseId, collection } = firestoreCollection(config, collectionOverride)
  const path = collection.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${path}`
}

export function partnerAppEndpoint(config: PartnerAppConfig, pageSize?: number) {
  if (config.mode === 'endpoint') {
    const url = config.endpointUrl.trim()
    if (!url) throw new Error('Enter the REST endpoint URL for the partner app.')
    return url
  }
  const url = firestoreCollectionUrl(config)
  const params = new URLSearchParams()
  if (pageSize) params.set('pageSize', String(pageSize))
  if (config.apiKey.trim()) params.set('key', config.apiKey.trim())
  const query = params.toString() ? `?${params.toString()}` : ''
  return `${url}${query}`
}

/** Firestore document URL used by the write-through actions. */
export function partnerAppDocumentEndpoint(config: PartnerAppConfig, documentId: string) {
  if (config.mode !== 'firestore') throw new Error('Live account actions require a Firestore connection.')
  const id = documentId.trim()
  if (!id) throw new Error('The delivery_app partner document ID is missing.')
  const params = new URLSearchParams()
  if (config.apiKey.trim()) params.set('key', config.apiKey.trim())
  const query = params.toString() ? `?${params.toString()}` : ''
  return `${firestoreCollectionUrl(config)}/${encodeURIComponent(id)}${query}`
}

async function requestPartnerApp(config: PartnerAppConfig, token: string, pageSize?: number): Promise<unknown> {
  const url = partnerAppEndpoint(config, pageSize)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const accessToken = await resolvePartnerAppToken(token, config.apiKey)
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  let response: Response
  try {
    response = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
  } catch (error) {
    throw new PartnerAppRequestError(`Could not reach the partner app. Check the URL, CORS, and network access.${error instanceof Error ? ` (${error.message})` : ''}`, url)
  }
  if (!response.ok) {
    let detail = ''
    try {
      const body: unknown = await response.json()
      if (isRecord(body)) {
        if (isRecord(body.error) && typeof body.error.message === 'string') detail = body.error.message
        else if (typeof body.message === 'string') detail = body.message
      }
    } catch {
      // The error response had no JSON body.
    }
    const authHint = response.status === 401 || response.status === 403
      ? ' Sign in with a Firebase administrator account, and verify that firestore.rules allows that account UID.'
      : ''
    throw new PartnerAppRequestError(`Partner app request failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}${authHint}`, url)
  }
  try {
    return await response.json()
  } catch {
    throw new PartnerAppRequestError('The partner app returned a response that was not valid JSON.', url)
  }
}

async function requestFirestoreCollection(config: PartnerAppConfig, token: string, collection: string, pageSize = 300): Promise<unknown> {
  if (config.mode !== 'firestore') return []
  const base = firestoreCollectionUrl(config, collection)
  const params = new URLSearchParams({ pageSize: String(pageSize) })
  if (config.apiKey.trim()) params.set('key', config.apiKey.trim())
  const url = `${base}?${params.toString()}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  const accessToken = await resolvePartnerAppToken(token, config.apiKey)
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
  if (!response.ok) throw new PartnerAppRequestError(`Support ticket request failed (HTTP ${response.status}).`, url)
  return response.json()
}

export function decodeFirestoreFields(fields: unknown): Record<string, unknown> {
  if (!isRecord(fields)) return {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) result[key] = decodeFirestoreValue(value)
  return result
}

function decodeFirestoreValue(value: unknown): unknown {
  if (!isRecord(value)) return null
  if (typeof value.stringValue === 'string') return value.stringValue
  if (typeof value.integerValue === 'string' || typeof value.integerValue === 'number') return Number(value.integerValue)
  if (typeof value.doubleValue === 'number') return value.doubleValue
  if (typeof value.booleanValue === 'boolean') return value.booleanValue
  if (typeof value.timestampValue === 'string') return value.timestampValue
  if ('nullValue' in value) return null
  if (typeof value.referenceValue === 'string') return value.referenceValue
  if (isRecord(value.geoPointValue)) return value.geoPointValue
  if (isRecord(value.mapValue)) return decodeFirestoreFields(value.mapValue.fields)
  if (isRecord(value.arrayValue) && Array.isArray(value.arrayValue.values)) return value.arrayValue.values.map(decodeFirestoreValue)
  return null
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
    const match = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
    if (match) {
      const value = source[match]
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  for (const key of keys) {
    const suffix = `.${key.toLowerCase()}`
    const match = Object.keys(source).find((candidate) => candidate.toLowerCase().endsWith(suffix))
    if (match) {
      const value = source[match]
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  return undefined
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter((item): item is string => Boolean(item))
  const text = asString(value)
  return text ? text.split(',').map((item) => item.trim()).filter(Boolean) : []
}

function flattenFields(source: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {}
  const walk = (value: unknown, key: string) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      output[key] = value.map((item) => (isRecord(item) ? JSON.stringify(item) : String(item))).join(', ')
      return
    }
    if (isRecord(value)) {
      for (const [childKey, child] of Object.entries(value)) walk(child, key ? `${key}.${childKey}` : childKey)
      return
    }
    output[key] = String(value)
  }
  for (const [key, value] of Object.entries(source)) walk(value, key)
  return output
}

function toPartnerAppRecord(fields: Record<string, unknown>, id: string, updatedAt: string | null, syncedAt: string): PartnerAppRecord {
  const readableFields = { ...flattenFields(fields), ...fields }
  const statusValue = pick(readableFields, ['status', 'availability', 'accountStatus', 'onlineStatus'])
  const onlineValue = pick(readableFields, ['isOnline', 'isAvailable', 'is_available', 'online', 'availability', 'availabilityStatus', 'onlineStatus'])
  const status = typeof statusValue === 'boolean' ? (statusValue ? 'Online' : 'Offline') : asString(statusValue)
  const normalizedOnline = typeof onlineValue === 'string' ? onlineValue.trim().toLowerCase() : null
  const normalizedStatus = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : null
  const isOnline = typeof onlineValue === 'boolean'
    ? onlineValue
    : normalizedOnline === 'true' || normalizedOnline === 'online' || normalizedOnline === 'available'
      ? true
      : normalizedOnline === 'false' || normalizedOnline === 'offline' || normalizedOnline === 'unavailable'
        ? false
        : typeof statusValue === 'boolean'
          ? statusValue
          : normalizedStatus === 'online' || normalizedStatus === 'available'
            ? true
            : normalizedStatus === 'offline' || normalizedStatus === 'unavailable'
              ? false
              : null
  return {
    id,
    partnerId: asString(pick(fields, ['partnerId', 'partner_id', 'deliveryPartnerId'])),
    name: asString(pick(fields, ['name', 'fullName', 'partnerName', 'displayName', 'applicantName'])) ?? id,
    phone: asString(pick(fields, ['phone', 'mobile', 'phoneNumber', 'maskedPhone', 'contact'])),
    email: asString(pick(fields, ['email', 'emailAddress'])),
    vehicle: asString(pick(fields, ['vehicle', 'vehicleType', 'vehicle_type'])),
    status,
    applicationStatus: asString(pick(fields, ['applicationStatus', 'application_status'])),
    isOnline,
    serviceAreas: asStringArray(pick(fields, ['serviceAreas', 'serviceArea', 'areas', 'zones'])),
    updatedAt: updatedAt ?? asString(pick(fields, ['updatedAt', 'updated_at', 'lastActive', 'lastSeen', 'modifiedAt'])),
    fields: flattenFields(fields),
    syncedAt,
  }
}

function fromFirestoreDocument(document: unknown, syncedAt: string): PartnerAppRecord | null {
  if (!isRecord(document) || typeof document.name !== 'string' || !isRecord(document.fields)) return null
  const id = document.name.split('/').pop() ?? ''
  if (!id) return null
  const fields = decodeFirestoreFields(document.fields)
  return toPartnerAppRecord(fields, id, typeof document.updateTime === 'string' ? document.updateTime : null, syncedAt)
}

export function normalizePartnerAppRecords(payload: unknown, syncedAt: string): PartnerAppRecord[] {
  const records: PartnerAppRecord[] = []
  if (isRecord(payload) && Array.isArray(payload.documents)) {
    for (const document of payload.documents) {
      const record = fromFirestoreDocument(document, syncedAt)
      if (record) records.push(record)
    }
  } else if (isRecord(payload) && typeof payload.name === 'string' && isRecord(payload.fields)) {
    const record = fromFirestoreDocument(payload, syncedAt)
    if (record) records.push(record)
  } else if (Array.isArray(payload)) {
    payload.forEach((item, index) => {
      if (!isRecord(item)) return
      const firestoreRecord = fromFirestoreDocument(item, syncedAt)
      if (firestoreRecord) {
        records.push(firestoreRecord)
        return
      }
      const id = asString(pick(item, ['id', '_id', 'documentId', 'partnerId'])) ?? `record-${index + 1}`
      records.push(toPartnerAppRecord(item, id, asString(pick(item, ['updatedAt', 'updateTime', 'lastActive'])), syncedAt))
    })
  } else if (isRecord(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (!isRecord(value)) continue
      records.push(toPartnerAppRecord(value, key, asString(pick(value, ['updatedAt', 'updateTime', 'lastActive'])), syncedAt))
    }
  } else {
    throw new Error('The partner app response did not contain partner records.')
  }
  const unique = new Map<string, PartnerAppRecord>()
  for (const record of records) unique.set(record.id, record)
  return [...unique.values()]
}

export async function testPartnerAppConnection(config: PartnerAppConfig, token: string) {
  const payload = await requestPartnerApp(config, token, 1)
  const count = isRecord(payload) && Array.isArray(payload.documents)
    ? payload.documents.length
    : Array.isArray(payload) ? payload.length : undefined
  if (count === 0) return 'Connection succeeded, but the collection returned 0 records. Check the partners collection name and Firestore read rules.'
  return count ? `Connection succeeded. ${count} partner record${count === 1 ? '' : 's'} visible.` : 'Connection succeeded.'
}

export async function syncPartnerAppRecords(config: PartnerAppConfig, token: string) {
  const payload = await requestPartnerApp(config, token, 300)
  return normalizePartnerAppRecords(payload, new Date().toISOString())
}

function decodeTicketDocument(document: unknown, syncedAt: string): PartnerAppTicket | null {
  if (!isRecord(document) || typeof document.name !== 'string' || !isRecord(document.fields)) return null
  const id = document.name.split('/').pop() ?? ''
  const fields = decodeFirestoreFields(document.fields)
  if (!id || typeof fields.partnerUid !== 'string' || typeof fields.subject !== 'string' || typeof fields.message !== 'string') return null
  return {
    id,
    partnerUid: fields.partnerUid,
    subject: fields.subject,
    message: fields.message,
    status: typeof fields.status === 'string' ? fields.status : 'Open',
    createdAt: typeof fields.createdAt === 'string' ? fields.createdAt : syncedAt,
    updatedAt: typeof fields.updatedAt === 'string' ? fields.updatedAt : null,
    syncedAt,
  }
}

export async function syncPartnerAppTickets(config: PartnerAppConfig, token: string): Promise<PartnerAppTicket[]> {
  if (config.mode !== 'firestore') return []
  const syncedAt = new Date().toISOString()
  const payload = await requestFirestoreCollection(config, token, 'support_tickets')
  const documents = isRecord(payload) && Array.isArray(payload.documents) ? payload.documents : []
  return documents.map((document) => decodeTicketDocument(document, syncedAt)).filter((ticket): ticket is PartnerAppTicket => Boolean(ticket))
}

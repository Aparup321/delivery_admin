import type { PartnerAppConfig } from '../domain/model.ts'
import {
  decodeFirestoreFields,
  isRecord,
  PartnerAppRequestError,
  readPartnerAppToken,
} from './partnerApp.ts'
import { resolvePartnerAppToken } from './firebaseAuth.ts'

export interface LiveDeliveryStop {
  name: string
  address: string
  latitude: number
  longitude: number
}

export interface LiveDeliveryEvent {
  status: string
  at: string
}

/** Text-only handover proof written when the partner closes the delivery. */
export interface LiveDeliveryProof {
  method: 'otp'
  verifiedAt: string
  recipientName: string | null
  note: string | null
  latitude: number | null
  longitude: number | null
  accuracy: number | null
}

export interface LivePartnerLocation {
  latitude: number
  longitude: number
  accuracy: number | null
  updatedAt: string | null
}

/** A delivery document written by delivery_app. */
export interface LiveDelivery {
  id: string
  displayId: string
  partnerUid: string
  partnerName: string
  vehicleType: string
  status: string
  nativeStatus: string
  source: string
  category: 'Grocery' | 'Restaurant'
  pickup: LiveDeliveryStop
  destination: LiveDeliveryStop
  distanceKm: number
  etaMinutes: number
  earnings: number
  itemCount: number
  paymentMode: string
  customerName: string
  customerPhoneMasked: string
  note: string | null
  dropOtp: string | null
  requestedAt: string | null
  acceptedAt: string | null
  completedAt: string | null
  cancellationReason: string | null
  events: LiveDeliveryEvent[]
  partnerResponse: { decision: 'rejected'; at: string; reason: string | null } | null
  proof: LiveDeliveryProof | null
  currentLocation: LivePartnerLocation | null
  updatedAt: string | null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function asStop(value: unknown): LiveDeliveryStop | null {
  if (!isRecord(value)) return null

  const name = asText(value.name)
  const address = asText(value.address)
  const latitude = asNumber(value.latitude)
  const longitude = asNumber(value.longitude)

  if (!name && !address && latitude === 0 && longitude === 0) return null

  return { name, address, latitude, longitude }
}

function asLocation(value: unknown): LivePartnerLocation | null {
  if (!isRecord(value)) return null

  const latitude = asNumber(value.latitude)
  const longitude = asNumber(value.longitude)

  if (latitude === 0 && longitude === 0) return null

  return {
    latitude,
    longitude,
    accuracy: typeof value.accuracy === 'number' ? value.accuracy : null,
    updatedAt: asText(value.updatedAt) || null,
  }
}

function asEvents(value: unknown): LiveDeliveryEvent[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const status = asText(item.status)
    const at = asText(item.at)
    return status && at ? [{ status, at }] : []
  })
}

function normalizeLiveDelivery(document: unknown): LiveDelivery | null {
  if (!isRecord(document) || typeof document.name !== 'string' || !isRecord(document.fields)) {
    return null
  }

  const id = document.name.split('/').pop() ?? ''
  const fields = decodeFirestoreFields(document.fields)
  const pickup = asStop(fields.pickup)
  const destination = asStop(fields.destination)
  if (!id || !pickup || !destination) return null

  const nativeStatus = asText(fields.status) || 'accepted'
  const proofRecord = isRecord(fields.proof) ? fields.proof : null
  const proof: LiveDeliveryProof | null =
    proofRecord && asText(proofRecord.verifiedAt)
      ? {
        method: 'otp',
        verifiedAt: asText(proofRecord.verifiedAt),
        recipientName: asText(proofRecord.recipientName) || null,
        note: asText(proofRecord.note) || null,
        latitude:
          typeof proofRecord.latitude === 'number'
            ? proofRecord.latitude
            : null,
        longitude:
          typeof proofRecord.longitude === 'number'
            ? proofRecord.longitude
            : null,
        accuracy:
          typeof proofRecord.accuracy === 'number'
            ? proofRecord.accuracy
            : null,
      }
      : null

  return {
    id,
    displayId: asText(fields.displayId) || `#${id}`,
    partnerUid: asText(fields.partnerUid),
    partnerName: asText(fields.partnerName) || 'Delivery partner',
    vehicleType: asText(fields.vehicleType) || 'Vehicle unavailable',
    status: asText(fields.adminStatus) || nativeStatus,
    nativeStatus,
    source: asText(fields.source) || 'live',
    category: asText(fields.category) === 'Restaurant' ? 'Restaurant' : 'Grocery',
    pickup,
    destination,
    distanceKm: asNumber(fields.distanceKm),
    etaMinutes: asNumber(fields.etaMinutes),
    earnings: asNumber(fields.earnings),
    itemCount: asNumber(fields.itemCount),
    paymentMode: asText(fields.paymentMode),
    customerName: asText(fields.customerName),
    customerPhoneMasked: asText(fields.customerPhoneMasked),
    note: asText(fields.note) || null,
    dropOtp: asText(fields.dropOtp) || null,
    requestedAt: asText(fields.requestedAt) || null,
    acceptedAt: asText(fields.acceptedAt) || null,
    completedAt: asText(fields.completedAt) || null,
    cancellationReason: asText(fields.cancellationReason) || null,
    events: asEvents(fields.events),
    partnerResponse: isRecord(fields.partnerResponse) && asText(fields.partnerResponse.decision) === 'rejected'
      ? {
        decision: 'rejected' as const,
        at: asText(fields.partnerResponse.at) || new Date().toISOString(),
        reason: asText(fields.partnerResponse.reason) || null,
      }
      : null,
    proof,
    currentLocation: asLocation(fields.currentLocation),
    updatedAt: asText(fields.updatedAt) || null,
  }
}

export function normalizeLiveDeliveries(payload: unknown): LiveDelivery[] {
  if (!isRecord(payload) || !Array.isArray(payload.documents)) return []

  return payload.documents
    .map(normalizeLiveDelivery)
    .filter((delivery): delivery is LiveDelivery => Boolean(delivery))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

// A short shared cache keeps page navigation and the provider's terminal-state
// reconciliation from re-reading the same collection seconds apart. Firestore
// charges one document read per record returned to every REST list call.
const LIVE_CACHE_MS = 30_000
let liveCache: { key: string; at: number; deliveries: LiveDelivery[] } | null = null
let liveInFlight: { key: string; promise: Promise<LiveDelivery[]> } | null = null

function liveConnectionKey(config: PartnerAppConfig) {
  return [config.projectId.trim(), config.databaseId.trim(), config.apiKey.trim()].join('|')
}

/** The last successful read for this connection, when it is still fresh. */
export function readCachedLiveDeliveries(
  config: PartnerAppConfig,
  maxAgeMs = LIVE_CACHE_MS,
) {
  if (!liveCache || liveCache.key !== liveConnectionKey(config)) return null
  return Date.now() - liveCache.at < maxAgeMs ? liveCache.deliveries : null
}

/** Forces the next read to hit Firestore (used by explicit refresh actions). */
export function invalidateLiveDeliveries() {
  liveCache = null
}

function deliveryCollectionUrl(config: PartnerAppConfig, pageSize: number) {
  const projectId = config.projectId.trim()
  if (!projectId) throw new Error('Enter the Firebase project ID for the partner app.')

  const databaseId = config.databaseId.trim() || '(default)'
  const params = new URLSearchParams({ pageSize: String(pageSize) })
  if (config.apiKey.trim()) params.set('key', config.apiKey.trim())

  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/deliveries?${params.toString()}`
}

/** Reads the live delivery collection written by delivery_app. */
export async function fetchLiveDeliveries(
  config: PartnerAppConfig,
  token: string,
): Promise<LiveDelivery[]> {
  if (config.mode !== 'firestore') {
    throw new Error('Live deliveries require a Firestore connection.')
  }

  const url = deliveryCollectionUrl(config, 300)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const accessToken = await resolvePartnerAppToken(token, config.apiKey)
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response: Response
  try {
    response = await fetch(url, { headers, cache: 'no-store' })
  } catch (error) {
    throw new PartnerAppRequestError(
      `Could not reach delivery_app's delivery records.${error instanceof Error ? ` (${error.message})` : ''}`,
      url,
    )
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
      ? ' Sign in a Firebase administrator in Settings → Partner app, or check the Firestore rules for the deliveries collection.'
      : ''
    throw new PartnerAppRequestError(
      `Delivery sync failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}${authHint}`,
      url,
    )
  }

  return normalizeLiveDeliveries(await response.json())
}

/**
 * Reads live deliveries through a shared cache and in-flight request, so a page
 * mount, a retry and the provider's reconciliation pass collapse into one
 * Firestore read. Failures are not cached.
 */
export async function fetchLiveDeliveriesCached(
  config: PartnerAppConfig,
  token: string,
  maxAgeMs = LIVE_CACHE_MS,
): Promise<LiveDelivery[]> {
  const key = liveConnectionKey(config)
  const cached = readCachedLiveDeliveries(config, maxAgeMs)
  if (cached) return cached
  if (liveInFlight?.key === key) return liveInFlight.promise

  const request = fetchLiveDeliveries(config, token)
    .then((deliveries) => {
      liveCache = { key, at: Date.now(), deliveries }
      return deliveries
    })
    .finally(() => {
      if (liveInFlight?.key === key) liveInFlight = null
    })
  liveInFlight = { key, promise: request }
  return request
}

/** Token reader kept here so pages do not reach into session storage. */
export function readLiveDeliveryToken() {
  return readPartnerAppToken()
}

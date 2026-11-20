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
  requestedAt: string | null
  acceptedAt: string | null
  completedAt: string | null
  cancellationReason: string | null
  events: LiveDeliveryEvent[]
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

  return {
    id,
    displayId: asText(fields.displayId) || `#${id}`,
    partnerUid: asText(fields.partnerUid),
    partnerName: asText(fields.partnerName) || 'Delivery partner',
    vehicleType: asText(fields.vehicleType) || 'Vehicle unavailable',
    status: asText(fields.adminStatus) || nativeStatus,
    nativeStatus,
    source: asText(fields.source) || 'live',
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
    requestedAt: asText(fields.requestedAt) || null,
    acceptedAt: asText(fields.acceptedAt) || null,
    completedAt: asText(fields.completedAt) || null,
    cancellationReason: asText(fields.cancellationReason) || null,
    events: asEvents(fields.events),
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

/** Token reader kept here so pages do not reach into session storage. */
export function readLiveDeliveryToken() {
  return readPartnerAppToken()
}

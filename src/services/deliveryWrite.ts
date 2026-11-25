/**
 * Write-through helpers that publish delivery offers to delivery_app's
 * `deliveries` collection over the Firestore REST API.
 *
 * Assigning a partner PATCHes (and thereby creates) `deliveries/{deliveryId}`
 * with the full offer document; the partner app's live listener picks it up
 * immediately. Cancelling an assigned delivery PATCHes only the cancellation
 * fields so the partner keeps their milestone history. Firestore Security
 * Rules in delivery_app allow only the allow-listed administrator UID to
 * create or fully update these documents.
 */

import type { PartnerAppConfig } from '../domain/model.ts'
import { decodeFirestoreFields, isRecord, PartnerAppRequestError, partnerAppCollectionDocumentEndpoint } from './partnerApp.ts'
import { encodeValue } from './partnerAppWrite.ts'
import { resolvePartnerAppToken } from './firebaseAuth.ts'

async function requestDeliveryDocument(
  config: PartnerAppConfig,
  token: string,
  documentId: string,
  fields: Record<string, unknown>,
  fieldPaths: string[] | null,
): Promise<void> {
  const url = new URL(partnerAppCollectionDocumentEndpoint(config, 'deliveries', documentId))

  if (fieldPaths) {
    for (const path of fieldPaths) url.searchParams.append('updateMask.fieldPaths', path)
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const accessToken = await resolvePartnerAppToken(token, config.apiKey)
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'PATCH',
      headers,
      // Without an update mask the PATCH creates or replaces the document,
      // which is what an offer needs; the partner cannot create one.
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)])),
      }),
    })
  } catch (error) {
    throw new PartnerAppRequestError(
      `Could not reach delivery_app's deliveries collection.${error instanceof Error ? ` (${error.message})` : ''}`,
      url.toString(),
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
      ? ' Sign in a Firebase administrator in Settings → Partner app, or verify that firestore.rules allows the admin UID to write deliveries.'
      : ''
    throw new PartnerAppRequestError(
      `delivery_app delivery write failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}${authHint}`,
      url.toString(),
    )
  }
}

export interface DeliveryAssignmentWrite {
  config: PartnerAppConfig
  token: string
  /** Console delivery id, e.g. DLV-1049; also the Firestore document id. */
  deliveryId: string
  /** delivery_app Firebase UID of the assigned partner. */
  partnerAppUid: string
  partnerName: string
  partnerVehicle: string
  category: 'Grocery' | 'Restaurant'
  pickupName: string
  pickupAddress: string
  pickupLatitude: number
  pickupLongitude: number
  dropName: string
  dropAddress: string
  dropLatitude: number
  dropLongitude: number
  distanceKm: number
  etaMinutes: number
  earnings: number
  itemCount: number
  paymentMode: 'Prepaid' | 'Cash on delivery'
  customerName: string | null
  customerPhone: string | null
  orderValue: number | null
  collectAmount: number | null
  note: string | null
  /** 4-digit code the customer reads out; empty when the console has none. */
  dropOtp: string | null
  /** Absolute offer deadline for the partner's response window. */
  expiresAt: string
  requestedAt: string
  at: string
}

/**
 * Creates or replaces the offer document for the assigned partner. Replacing
 * is safe: assignment is the only writer of these fields, and a reassignment
 * intentionally moves `partnerUid` to the new partner.
 */
export async function writeDeliveryAssignment(write: DeliveryAssignmentWrite): Promise<void> {
  await requestDeliveryDocument(
    write.config,
    write.token,
    write.deliveryId,
    {
      deliveryId: write.deliveryId,
      displayId: `#${write.deliveryId}`,
      partnerUid: write.partnerAppUid,
      partnerName: write.partnerName,
      vehicleType: write.partnerVehicle,
      source: 'live',
      category: write.category,
      status: 'assigned',
      adminStatus: 'Pending',
      pickup: {
        name: write.pickupName,
        address: write.pickupAddress,
        latitude: write.pickupLatitude,
        longitude: write.pickupLongitude,
      },
      destination: {
        name: write.dropName,
        address: write.dropAddress,
        latitude: write.dropLatitude,
        longitude: write.dropLongitude,
      },
      distanceKm: write.distanceKm,
      etaMinutes: write.etaMinutes,
      earnings: write.earnings,
      itemCount: write.itemCount,
      paymentMode: write.paymentMode,
      customerName: write.customerName,
      customerPhone: write.customerPhone,
      customerPhoneMasked: write.customerPhone
        ? `+91 ••••• ${write.customerPhone.replace(/\D/g, '').slice(-4)}`
        : null,
      orderValue: write.orderValue,
      collectAmount: write.collectAmount,
      note: write.note,
      dropOtp: write.dropOtp,
      expiresAt: write.expiresAt,
      requestedAt: write.requestedAt,
      acceptedAt: null,
      completedAt: null,
      cancellationReason: null,
      proof: null,
      events: [],
      currentLocation: null,
      createdAt: write.at,
      updatedAt: write.at,
    },
    null,
  )
}

export interface DeliveryDetailsWrite {
  config: PartnerAppConfig
  token: string
  deliveryId: string
  partnerAppUid: string
  category: 'Grocery' | 'Restaurant'
  pickupName: string
  pickupAddress: string
  pickupLatitude: number
  pickupLongitude: number
  dropName: string
  dropAddress: string
  dropLatitude: number
  dropLongitude: number
  distanceKm: number
  etaMinutes: number
  earnings: number
  itemCount: number
  paymentMode: 'Prepaid' | 'Cash on delivery'
  customerName: string | null
  customerPhone: string | null
  orderValue: number | null
  collectAmount: number | null
  note: string | null
  at: string
}

interface DeliveryDocumentSnapshot {
  fields: Record<string, unknown>
  partnerUid: string
  status: string
}

async function readDeliveryDocument(
  config: PartnerAppConfig,
  token: string,
  documentId: string,
): Promise<DeliveryDocumentSnapshot | null> {
  const url = partnerAppCollectionDocumentEndpoint(config, 'deliveries', documentId)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const accessToken = await resolvePartnerAppToken(token, config.apiKey)
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response: Response
  try {
    response = await fetch(url, { headers, cache: 'no-store' })
  } catch (error) {
    throw new PartnerAppRequestError(
      `Could not reach delivery_app's delivery record.${error instanceof Error ? ` (${error.message})` : ''}`,
      url,
    )
  }
  if (response.status === 404) return null
  if (!response.ok) {
    throw new PartnerAppRequestError(
      `Could not read the live delivery before editing (HTTP ${response.status}).`,
      url,
    )
  }
  const body: unknown = await response.json()
  if (!isRecord(body) || !isRecord(body.fields)) {
    throw new PartnerAppRequestError('The live delivery record was not valid.', url)
  }
  const fields = decodeFirestoreFields(body.fields)
  return {
    fields,
    partnerUid: typeof fields.partnerUid === 'string' ? fields.partnerUid.trim() : '',
    status: typeof fields.status === 'string' ? fields.status.trim() : '',
  }
}

/**
 * Updates the route, customer, package, and payout details of an existing
 * offer without touching its status, acceptance, events, proof, location, or
 * drop code. Refuses to write after the partner has accepted or declined.
 */
export async function writeDeliveryDetails(write: DeliveryDetailsWrite): Promise<void> {
  const current = await readDeliveryDocument(write.config, write.token, write.deliveryId)
  if (!current) {
    throw new PartnerAppRequestError(
      'The live delivery offer no longer exists. Refresh and reassign before editing.',
      partnerAppCollectionDocumentEndpoint(write.config, 'deliveries', write.deliveryId),
    )
  }
  if (current.partnerUid !== write.partnerAppUid) {
    throw new PartnerAppRequestError(
      'The live delivery is assigned to a different partner. Refresh before editing.',
      partnerAppCollectionDocumentEndpoint(write.config, 'deliveries', write.deliveryId),
    )
  }
  if (current.status !== 'assigned') {
    throw new PartnerAppRequestError(
      'The partner has already accepted or started this delivery. Details are locked after acceptance.',
      partnerAppCollectionDocumentEndpoint(write.config, 'deliveries', write.deliveryId),
    )
  }
  const partnerResponse = isRecord(current.fields.partnerResponse) ? current.fields.partnerResponse : null
  if (partnerResponse?.decision === 'rejected') {
    throw new PartnerAppRequestError(
      'The partner declined this offer. Reassign the delivery before editing it.',
      partnerAppCollectionDocumentEndpoint(write.config, 'deliveries', write.deliveryId),
    )
  }

  const customerPhone = write.customerPhone?.replace(/\D/g, '') ?? ''
  const fields = {
    category: write.category,
    pickup: {
      name: write.pickupName,
      address: write.pickupAddress,
      latitude: write.pickupLatitude,
      longitude: write.pickupLongitude,
    },
    destination: {
      name: write.dropName,
      address: write.dropAddress,
      latitude: write.dropLatitude,
      longitude: write.dropLongitude,
    },
    distanceKm: write.distanceKm,
    etaMinutes: write.etaMinutes,
    earnings: write.earnings,
    itemCount: write.itemCount,
    paymentMode: write.paymentMode,
    customerName: write.customerName,
    customerPhone: customerPhone || null,
    customerPhoneMasked: customerPhone ? `+91 ••••• ${customerPhone.slice(-4)}` : null,
    orderValue: write.orderValue,
    collectAmount: write.collectAmount,
    note: write.note,
    updatedAt: write.at,
  }
  await requestDeliveryDocument(
    write.config,
    write.token,
    write.deliveryId,
    fields,
    Object.keys(fields),
  )
}

export interface DeliveryCancellationWrite {
  config: PartnerAppConfig
  token: string
  deliveryId: string
  /** delivery_app Firebase UID the offer was written for. */
  partnerAppUid: string
  reason: string
  at: string
}

/** Removes an unaccepted offer from the previous partner's app. */
export async function writeDeliveryUnassign(write: DeliveryCancellationWrite): Promise<void> {
  await requestDeliveryDocument(
    write.config,
    write.token,
    write.deliveryId,
    {
      partnerUid: '',
      status: 'cancelled',
      adminStatus: 'Pending',
      cancellationReason: write.reason,
      completedAt: null,
      updatedAt: write.at,
    },
    ['partnerUid', 'status', 'adminStatus', 'cancellationReason', 'completedAt', 'updatedAt'],
  )
}

/** Cancels an offer or an in-progress delivery on the shared document. */
export async function writeDeliveryCancellation(write: DeliveryCancellationWrite): Promise<void> {
  await requestDeliveryDocument(
    write.config,
    write.token,
    write.deliveryId,
    {
      status: 'cancelled',
      adminStatus: 'Cancelled',
      cancellationReason: write.reason,
      completedAt: write.at,
      updatedAt: write.at,
    },
    ['status', 'adminStatus', 'cancellationReason', 'completedAt', 'updatedAt'],
  )
}

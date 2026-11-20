/**
 * Write-through helpers for the delivery_app partner document.
 *
 * The admin console deliberately talks to Firestore over REST. When an
 * Administrator approves/rejects an application or suspends/restores an
 * account, the same decision is PATCHed onto `partners/{uid}` in delivery_app
 * so the partner app's live listener can react immediately.
 */

import type { PartnerAppConfig } from '../domain/model.ts'
import { isRecord, PartnerAppRequestError, partnerAppDocumentEndpoint } from './partnerApp.ts'
import { resolvePartnerAppToken } from './firebaseAuth.ts'

export type PartnerAppAccountStatus = 'pending' | 'active' | 'paused'

function encodeValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value }
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (isRecord(value)) {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeValue(child)])),
      },
    }
  }
  return { nullValue: null }
}

async function patchPartnerDocument(
  config: PartnerAppConfig,
  token: string,
  documentId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const url = new URL(partnerAppDocumentEndpoint(config, documentId))
  for (const field of Object.keys(fields)) url.searchParams.append('updateMask.fieldPaths', field)

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
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)])),
      }),
    })
  } catch (error) {
    throw new PartnerAppRequestError(
      `Could not reach delivery_app's Firestore document.${error instanceof Error ? ` (${error.message})` : ''}`,
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
      ? ' Sign in a Firebase administrator in Settings → Partner app, or verify that firestore.rules allows the admin UID.'
      : ''
    throw new PartnerAppRequestError(
      `delivery_app update failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}${authHint}`,
      url.toString(),
    )
  }
}

export interface ApplicationDecisionWrite {
  config: PartnerAppConfig
  token: string
  partnerAppUid: string
  applicationId: string
  /** The admin partner directory ID created by an approval, when available. */
  adminPartnerId: string | null
  decision: 'Approved' | 'Rejected'
  reason: string
  reviewedBy: string
  at: string
}

/** Mirrors an admin KYC decision onto delivery_app's partner document. */
export async function writeApplicationDecision(write: ApplicationDecisionWrite): Promise<void> {
  const approved = write.decision === 'Approved'
  await patchPartnerDocument(write.config, write.token, write.partnerAppUid, {
    applicationStatus: approved ? 'approved' : 'rejected',
    status: approved ? 'active' : 'pending',
    statusUpdatedAt: write.at,
    updatedAt: write.at,
    adminPartnerId: write.adminPartnerId,
    adminReview: {
      decision: approved ? 'approved' : 'rejected',
      reason: write.reason.trim() || null,
      applicationId: write.applicationId,
      reviewedBy: write.reviewedBy,
      reviewedAt: write.at,
      adminPartnerId: write.adminPartnerId,
    },
  })
}

export interface AccountStatusWrite {
  config: PartnerAppConfig
  token: string
  partnerAppUid: string
  adminPartnerId: string | null
  /** true reinstates the account; false suspends it. */
  active: boolean
  reason: string
  updatedBy: string
  /** Timed suspension deadline; cleared when the account is reinstated. */
  suspendedUntil?: string | null
  suspensionDays?: number | null
  at: string
}

/** Mirrors an admin suspension/reinstatement onto delivery_app's partner document. */
export async function writePartnerAccountStatus(write: AccountStatusWrite): Promise<void> {
  await patchPartnerDocument(write.config, write.token, write.partnerAppUid, {
    status: write.active ? 'active' : 'paused',
    statusUpdatedAt: write.at,
    updatedAt: write.at,
    adminPartnerId: write.adminPartnerId,
    adminSuspension: {
      active: !write.active,
      reason: write.reason.trim() || null,
      updatedBy: write.updatedBy,
      updatedAt: write.at,
      adminPartnerId: write.adminPartnerId,
      until: write.active ? null : write.suspendedUntil ?? null,
      days: write.active ? null : write.suspensionDays ?? null,
    },
  })
}

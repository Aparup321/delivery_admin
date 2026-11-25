import { useEffect, useRef } from 'react'
import type { AdminSession } from '../auth/adminSession'
import type { PartnerAppDocument, PartnerAppRecord, PartnerAppTicket } from '../domain/model'
import { readPartnerAppToken, syncPartnerAppDocuments, syncPartnerAppRecords, syncPartnerAppTickets } from '../services/partnerApp'
import { readFirebaseAdminSession } from '../services/firebaseAuth'
import {
  activeQuotaMessage,
  blockQuotaUntilReset,
  clearQuotaBlock,
  readQuotaBlockedUntil,
} from '../services/firestoreQuota'
import { useOperations } from '../state/OperationsProvider'

// REST has no Firestore listener, but every poll reads documents against the
// project's daily quota. Poll once a minute and stay paused until the next
// daily reset when Firestore answers 429 Quota exceeded, so an exhausted quota
// stops generating failing requests instead of retrying every few minutes.
const POLL_INTERVAL_MS = 60_000
const FOCUS_REFRESH_MS = 45_000

/** Stable comparison for the extra string fields a record carries. */
function fieldsKey(fields: Record<string, string>) {
  return Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\u0000')
}

/** Ignores a refresh when the cached partner records already match. */
function recordsChanged(previous: PartnerAppRecord[], next: PartnerAppRecord[]) {
  if (previous.length !== next.length) return true
  const previousById = new Map(previous.map((record) => [record.id, record]))
  return next.some((record) => {
    const before = previousById.get(record.id)
    return !before
      || before.name !== record.name
      || before.phone !== record.phone
      || before.email !== record.email
      || before.vehicle !== record.vehicle
      || before.status !== record.status
      || before.applicationStatus !== record.applicationStatus
      || before.isOnline !== record.isOnline
      || before.partnerId !== record.partnerId
      || before.updatedAt !== record.updatedAt
      || before.serviceAreas.join('|') !== record.serviceAreas.join('|')
      || fieldsKey(before.fields) !== fieldsKey(record.fields)
  })
}

function ticketsChanged(previous: PartnerAppTicket[], next: PartnerAppTicket[]) {
  if (previous.length !== next.length) return true
  const previousById = new Map(previous.map((ticket) => [ticket.id, ticket]))
  return next.some((ticket) => {
    const before = previousById.get(ticket.id)
    return !before || before.subject !== ticket.subject || before.message !== ticket.message || before.status !== ticket.status || before.updatedAt !== ticket.updatedAt
  })
}

function documentsChanged(previous: PartnerAppDocument[], next: PartnerAppDocument[]) {
  if (previous.length !== next.length) return true
  const previousById = new Map(previous.map((document) => [document.id, JSON.stringify(document.files)]))
  return next.some((document) => previousById.get(document.id) !== JSON.stringify(document.files))
}

/**
 * Loads delivery_app partner records after a Firebase data connection and
 * keeps them fresh while the console stays open. The REST fallback refreshes
 * once a minute because this app does not yet use the Firestore Web SDK, and it
 * pauses entirely until the daily reset when Firestore reports quota
 * exhaustion. The console identity can
 * remain Demo access; the Firebase session only authorizes delivery_app data.
 * Without a Firebase session the seeded sample partners are left untouched.
 */
export function useAutoPartnerSync(session: AdminSession, enabled = true) {
  const { frame, dispatch } = useOperations()
  const lastAttempt = useRef(0)
  const recordsRef = useRef(frame.data.partnerAppRecords)
  const ticketsRef = useRef(frame.data.partnerAppTickets)
  const documentsRef = useRef(frame.data.partnerAppDocuments)
  const config = frame.data.partnerApp
  const connectionKey = [
    config.mode,
    config.projectId,
    config.apiKey,
    config.databaseId,
    config.partnersCollection,
    config.endpointUrl,
  ].join('|')

  useEffect(() => {
    recordsRef.current = frame.data.partnerAppRecords
    ticketsRef.current = frame.data.partnerAppTickets
    documentsRef.current = frame.data.partnerAppDocuments
  }, [frame.data.partnerAppRecords, frame.data.partnerAppTickets, frame.data.partnerAppDocuments])

  useEffect(() => {
    if (!enabled || !readFirebaseAdminSession()) return
    const configured = config.mode === 'firestore'
      ? Boolean(config.projectId.trim() && config.partnersCollection.trim())
      : Boolean(config.endpointUrl.trim())
    if (!configured) return

    let active = true
    // Keep the in-flight flag per effect run. React StrictMode starts a second
    // run while the first request is still pending; a shared ref would make the
    // second run skip the request while the first run discards its result.
    let inFlight = false

    // Replace the raw 429 stored by an earlier session with the reset notice,
    // once, so a reload explains why live data is paused.
    const pausedMessage = activeQuotaMessage(config.projectId)
    if (pausedMessage && config.lastError !== pausedMessage) {
      dispatch({ type: 'partnerApp.failed', message: pausedMessage })
    }

    const refresh = async (force: boolean) => {
      if (!active || inFlight) return
      // Hidden tabs gain nothing from a refresh; save the quota until the
      // operator looks at the console again.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (readQuotaBlockedUntil(config.projectId)) return
      const now = Date.now()
      if (!force && now - lastAttempt.current < FOCUS_REFRESH_MS) return
      lastAttempt.current = now
      inFlight = true
      try {
        const token = readPartnerAppToken()
        const [records, tickets, documents] = await Promise.all([
          syncPartnerAppRecords(config, token),
          // Optional collections may deploy after the core partner rules;
          // keep the core sync working during that rollout.
          syncPartnerAppTickets(config, token).catch(() => []),
          syncPartnerAppDocuments(config, token).catch(() => []),
        ])
        if (!active) return
        clearQuotaBlock(config.projectId)
        if (!recordsChanged(recordsRef.current, records) && !ticketsChanged(ticketsRef.current, tickets) && !documentsChanged(documentsRef.current, documents)) return
        dispatch({ type: 'partnerApp.sync-result', records, tickets, documents, at: new Date().toISOString(), silent: true })
      } catch (error) {
        if (!active) return
        // A quota-exhausted project keeps answering 429 until the daily reset;
        // pause automatic polling rather than repeating the same failure.
        const message = blockQuotaUntilReset(error, config.projectId)?.message
          ?? (error instanceof Error ? error.message : 'Automatic partner sync failed.')
        dispatch({ type: 'partnerApp.failed', message })
      } finally {
        inFlight = false
      }
    }

    const lastSync = config.lastSyncAt
      ? new Date(config.lastSyncAt).getTime()
      : 0
    // Partner records are not part of the shared workflow document. A new
    // browser profile can inherit a recent lastSyncAt while its own cache is
    // empty, so load once instead of leaving every partner unlinked for a
    // full poll interval.
    if (!lastSync || Date.now() - lastSync >= POLL_INTERVAL_MS || recordsRef.current.length === 0) {
      void refresh(true)
    }

    const timer = window.setInterval(() => void refresh(false), POLL_INTERVAL_MS)
    const onFocus = () => void refresh(false)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh(false)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // `connectionKey` captures every setting that changes the request target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session.mode, session.userId, connectionKey, dispatch])
}

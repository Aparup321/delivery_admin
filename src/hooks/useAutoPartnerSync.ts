import { useEffect, useRef } from 'react'
import type { AdminSession } from '../auth/adminSession'
import type { PartnerAppRecord, PartnerAppTicket } from '../domain/model'
import { readPartnerAppToken, syncPartnerAppRecords, syncPartnerAppTickets } from '../services/partnerApp'
import { readFirebaseAdminSession } from '../services/firebaseAuth'
import { useOperations } from '../state/OperationsProvider'

const POLL_INTERVAL_MS = 60_000
const FOCUS_REFRESH_MS = 30_000

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

/**
 * Loads delivery_app partner records after a Firebase data connection and
 * keeps them fresh while the console stays open. The console identity can
 * remain Demo access; the Firebase session only authorizes delivery_app data.
 * Without a Firebase session the seeded sample partners are left untouched.
 */
export function useAutoPartnerSync(session: AdminSession, enabled = true) {
  const { frame, dispatch } = useOperations()
  const lastAttempt = useRef(0)
  const recordsRef = useRef(frame.data.partnerAppRecords)
  const ticketsRef = useRef(frame.data.partnerAppTickets)
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
  }, [frame.data.partnerAppRecords, frame.data.partnerAppTickets])

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

    const refresh = async (force: boolean) => {
      if (!active || inFlight) return
      const now = Date.now()
      if (!force && now - lastAttempt.current < FOCUS_REFRESH_MS) return
      lastAttempt.current = now
      inFlight = true
      try {
        const token = readPartnerAppToken()
          const [records, tickets] = await Promise.all([
            syncPartnerAppRecords(config, token),
            // Ticket collection rules may be deployed after the partner
            // collection rules; keep partner sync working during that rollout.
            syncPartnerAppTickets(config, token).catch(() => []),
          ])
        if (!active) return
        if (!recordsChanged(recordsRef.current, records) && !ticketsChanged(ticketsRef.current, tickets)) return
        dispatch({ type: 'partnerApp.sync-result', records, tickets, at: new Date().toISOString() })
      } catch (error) {
        if (!active) return
        dispatch({
          type: 'partnerApp.failed',
          message: error instanceof Error ? error.message : 'Automatic partner sync failed.',
        })
      } finally {
        inFlight = false
      }
    }

    const lastSync = config.lastSyncAt
      ? new Date(config.lastSyncAt).getTime()
      : 0
    if (!lastSync || Date.now() - lastSync >= POLL_INTERVAL_MS) {
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

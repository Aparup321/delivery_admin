import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { loadOperationsState, saveOperationsState } from '../data/persistence'
import { readPartnerAppToken } from '../services/partnerApp'
import { fetchLiveDeliveriesCached } from '../services/liveDeliveries'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
import { activeQuotaMessage, blockQuotaUntilReset, clearQuotaBlock } from '../services/firestoreQuota'
import { writeDeliveryAssignment, writeDeliveryCancellation } from '../services/deliveryWrite'
import { buildPartnerAppWriteIntent, type PartnerAppWriteIntent } from '../services/partnerAppIntent'
import { writeApplicationDecision, writePartnerAccountStatus } from '../services/partnerAppWrite'
import { appReducer, type AppFrame, type OperationAction } from './operationsReducer'

interface OperationsContextValue {
  frame: AppFrame
  dispatch: (action: OperationAction) => void
  storageAvailable: boolean
  /** Failed delivery_app writes waiting for a retry. */
  partnerAppWriteFailures: number
  retryPartnerAppWrites: () => void
}

const OperationsContext = createContext<OperationsContextValue | null>(null)

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [frame, dispatch] = useReducer(appReducer, undefined, (): AppFrame => ({ data: loadOperationsState(), feedback: null, sequence: 0 }))
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [partnerAppWriteFailures, setPartnerAppWriteFailures] = useState(0)
  const processedLogs = useRef<Set<string> | null>(null)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const failedWrites = useRef(new Map<string, PartnerAppWriteIntent>())
  const latestData = useRef(frame.data)

  useEffect(() => {
    latestData.current = frame.data
    setStorageAvailable(saveOperationsState(frame.data))
  }, [frame.data])

  useEffect(() => {
    const hasOfferAwaiting = frame.data.offers.some((offer) => offer.status === 'Awaiting Response')
    if (!hasOfferAwaiting) return
    const timer = window.setInterval(() => dispatch({ type: 'offer.expire-due', now: Date.now() }), 5_000)
    return () => window.clearInterval(timer)
  }, [frame.data.offers])

  useEffect(() => {
    const hasTimedSuspension = frame.data.partners.some((partner) => partner.availability === 'Suspended' && partner.suspendedUntil)
    if (!hasTimedSuspension) return
    // Reconcile immediately after a reload, then keep checking while a timed
    // suspension remains. The reducer returns the same frame when nothing is due.
    dispatch({ type: 'partner.expire-suspensions', now: Date.now() })
    const timer = window.setInterval(() => dispatch({ type: 'partner.expire-suspensions', now: Date.now() }), 30_000)
    return () => window.clearInterval(timer)
  }, [frame.data.partners])

  // Polls the partner app's live deliveries and reconciles terminal lifecycle
  // events (completed or cancelled in the partner app) onto the local records.
  // Without this, a partner who finished a delivery stayed "On Delivery" here
  // and every later assignment was refused. Best-effort: the tracking page
  // surfaces connection errors for operations.
  const liveSyncConfigKey = [
    frame.data.partnerApp.mode,
    frame.data.partnerApp.projectId,
    frame.data.partnerApp.databaseId,
    frame.data.partnerApp.apiKey,
  ].join('|')

  useEffect(() => {
    const config = latestData.current.partnerApp
    if (config.mode !== 'firestore' || !config.projectId.trim()) return
    if (!hasFirebaseAdminSession()) return

    let active = true

    const sync = async () => {
      // Hidden tabs gain nothing from a reconciliation pass; save the quota.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (activeQuotaMessage(config.projectId)) return
      try {
        const live = await fetchLiveDeliveriesCached(config, readPartnerAppToken())
        if (!active) return
        clearQuotaBlock(config.projectId)

        const pending = live
          .filter((item) => {
            const terminal = item.nativeStatus === 'delivered' || item.nativeStatus === 'cancelled'
              || item.status === 'Completed' || item.status === 'Cancelled'
            if (!terminal) return false
            const local = latestData.current.deliveries.find((delivery) => delivery.id === item.id)
            return Boolean(local) && local!.status !== 'Completed' && local!.status !== 'Cancelled'
          })
          .map((item) => ({
            id: item.id,
            status: (item.nativeStatus === 'cancelled' || item.status === 'Cancelled' ? 'cancelled' : 'delivered') as 'delivered' | 'cancelled',
            cancellationReason: item.cancellationReason,
            completedAt: item.completedAt,
          }))

        if (pending.length) {
          dispatch({ type: 'delivery.sync-live', at: new Date().toISOString(), deliveries: pending })
        }
      } catch (error) {
        // Polling is best-effort; the tracking page surfaces sync errors. A
        // quota-exhausted project keeps answering 429 until the daily reset,
        // so pause automatic polling instead of retrying every minute.
        blockQuotaUntilReset(error, config.projectId)
      }
    }

    void sync()
    const timer = window.setInterval(() => { void sync() }, 60_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
    // The config key covers every connection value that changes the request.
  }, [liveSyncConfigKey, dispatch])

  const performWrite = useCallback(async (intent: PartnerAppWriteIntent) => {
    const key = `${intent.kind}:${intent.targetId}`
    const applicationStatus = intent.kind === 'application'
      ? (intent.decision === 'Approved' ? 'approved' : 'rejected')
      : null
    const accountStatus = intent.kind === 'application'
      ? (intent.decision === 'Approved' ? 'active' : 'pending')
      : intent.kind === 'account'
        ? (intent.active ? 'active' : 'paused')
        : null

    try {
      const config = latestData.current.partnerApp
      if (intent.kind === 'application') {
        await writeApplicationDecision({
          config,
          token: readPartnerAppToken(),
          partnerAppUid: intent.partnerAppUid,
          applicationId: intent.applicationId,
          adminPartnerId: intent.adminPartnerId,
          decision: intent.decision,
          reason: intent.reason,
          reviewedBy: intent.reviewedBy,
          at: intent.at,
        })
      } else if (intent.kind === 'delivery-assignment') {
        await writeDeliveryAssignment({
          config,
          token: readPartnerAppToken(),
          deliveryId: intent.deliveryId,
          partnerAppUid: intent.partnerAppUid,
          partnerName: intent.partnerName,
          partnerVehicle: intent.partnerVehicle,
          category: intent.category,
          pickupName: intent.pickupName,
          pickupAddress: intent.pickupAddress,
          pickupLatitude: intent.pickupLatitude,
          pickupLongitude: intent.pickupLongitude,
          dropName: intent.dropName,
          dropAddress: intent.dropAddress,
          dropLatitude: intent.dropLatitude,
          dropLongitude: intent.dropLongitude,
          distanceKm: intent.distanceKm,
          etaMinutes: intent.etaMinutes,
          earnings: intent.earnings,
          itemCount: intent.itemCount,
          paymentMode: intent.paymentMode,
          note: intent.note,
          dropOtp: intent.dropOtp,
          expiresAt: intent.expiresAt,
          requestedAt: intent.requestedAt,
          at: intent.at,
        })
      } else if (intent.kind === 'delivery-cancel') {
        await writeDeliveryCancellation({
          config,
          token: readPartnerAppToken(),
          deliveryId: intent.deliveryId,
          partnerAppUid: intent.partnerAppUid,
          reason: intent.reason,
          at: intent.at,
        })
      } else {
        await writePartnerAccountStatus({
          config,
          token: readPartnerAppToken(),
          partnerAppUid: intent.partnerAppUid,
          adminPartnerId: intent.adminPartnerId,
          active: intent.active,
          reason: intent.reason,
          updatedBy: intent.updatedBy,
          suspendedUntil: intent.suspendedUntil,
          suspensionDays: intent.suspensionDays,
          at: intent.at,
        })
      }
      failedWrites.current.delete(key)
      setPartnerAppWriteFailures(failedWrites.current.size)
      dispatch({
        type: 'partnerApp.write-result',
        targetType: intent.targetType,
        targetId: intent.targetId,
        recordId: intent.partnerAppUid,
        ok: true,
        message: intent.kind === 'delivery-assignment'
          ? 'Offer published to the partner app.'
          : intent.kind === 'delivery-cancel'
            ? 'Cancellation published to the partner app.'
            : `${intent.targetType === 'Application' ? intent.decision.toLowerCase() : intent.active ? 'reinstated' : 'suspended'} in delivery_app.`,
        at: new Date().toISOString(),
        applicationStatus,
        accountStatus,
      })
    } catch (error) {
      failedWrites.current.set(key, intent)
      setPartnerAppWriteFailures(failedWrites.current.size)
      dispatch({
        type: 'partnerApp.write-result',
        targetType: intent.targetType,
        targetId: intent.targetId,
        recordId: intent.partnerAppUid,
        ok: false,
        message: error instanceof Error ? error.message : 'delivery_app update failed.',
        at: new Date().toISOString(),
        applicationStatus,
        accountStatus,
      })
    }
  }, [])

  const enqueueWrite = useCallback((intent: PartnerAppWriteIntent) => {
    // A newer decision for the same record supersedes an older failed write.
    failedWrites.current.delete(`${intent.kind}:${intent.targetId}`)
    setPartnerAppWriteFailures(failedWrites.current.size)
    writeQueue.current = writeQueue.current.then(() => performWrite(intent))
  }, [performWrite])

  const retryPartnerAppWrites = useCallback(() => {
    const pending = [...failedWrites.current.values()]
    failedWrites.current.clear()
    setPartnerAppWriteFailures(0)
    for (const intent of pending) enqueueWrite(intent)
  }, [enqueueWrite])

  useEffect(() => {
    const logs = frame.data.auditLogs
    if (!processedLogs.current) {
      processedLogs.current = new Set(logs.map((log) => log.id))
      return
    }
    const fresh = logs.filter((log) => !processedLogs.current?.has(log.id))
    if (!fresh.length) return
    for (const log of fresh) processedLogs.current.add(log.id)
    if (frame.data.partnerApp.mode !== 'firestore') return

    const seen = new Set<string>()
    for (const log of fresh) {
      const intent = buildPartnerAppWriteIntent(frame.data, log)
      if (!intent) continue
      const key = `${intent.kind}:${intent.targetId}`
      if (seen.has(key)) continue
      seen.add(key)
      enqueueWrite(intent)
    }
  }, [frame.data, enqueueWrite])

  const value = useMemo(
    () => ({ frame, dispatch, storageAvailable, partnerAppWriteFailures, retryPartnerAppWrites }),
    [frame, storageAvailable, partnerAppWriteFailures, retryPartnerAppWrites],
  )
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>
}

export function useOperations() {
  const context = useContext(OperationsContext)
  if (!context) throw new Error('useOperations must be used inside OperationsProvider')
  return context
}

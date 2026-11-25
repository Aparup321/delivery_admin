import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { readDemoAdminSession } from '../auth/adminSession'
import { loadOperationsState, saveOperationsState } from '../data/persistence'
import { readPartnerAppToken } from '../services/partnerApp'
import { fetchLiveDeliveriesCached } from '../services/liveDeliveries'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
import { activeQuotaMessage, blockQuotaUntilReset, clearQuotaBlock } from '../services/firestoreQuota'
import { writeDeliveryAssignment, writeDeliveryCancellation, writeDeliveryDetails, writeDeliveryUnassign } from '../services/deliveryWrite'
import { buildPartnerAppWriteIntent, type PartnerAppWriteIntent } from '../services/partnerAppIntent'
import { writeApplicationDecision, writePartnerAccountStatus } from '../services/partnerAppWrite'
import { clearDemoLocalWorkflow, hashSharedPayload, hasDemoLocalWorkflow, loadSharedWorkflow, markDemoLocalWorkflow, mergeSharedPayload, readSharedWorkflowMeta, saveSharedWorkflow, toSharedPayload, writeSharedWorkflowMeta } from '../services/sharedState'
import { appReducer, type AppFrame, type OperationAction } from './operationsReducer'

export interface SharedStateStatus {
  status: 'local' | 'loading' | 'synced' | 'saving' | 'error'
  lastSyncedAt: string | null
  updatedBy: string | null
  error: string | null
}

interface OperationsContextValue {
  frame: AppFrame
  dispatch: (action: OperationAction) => void
  storageAvailable: boolean
  /** Failed delivery_app writes waiting for a retry. */
  partnerAppWriteFailures: number
  retryPartnerAppWrites: () => void
  /** Firestore-backed administrator workflow state. */
  sharedState: SharedStateStatus
  refreshSharedState: () => void
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
  const [sharedState, setSharedState] = useState<SharedStateStatus>({ status: 'local', lastSyncedAt: null, updatedBy: null, error: null })
  const [sharedReady, setSharedReady] = useState(false)
  const [saveTick, setSaveTick] = useState(0)
  const lastSavedPayload = useRef('')
  const remoteRevision = useRef(0)
  const hydrateGuard = useRef(false)

  useEffect(() => {
    latestData.current = frame.data
    if (readDemoAdminSession()) {
      // Remember the exact demo workflow left in localStorage. A later real
      // sign-in must not mistake it for unsaved administrator work.
      markDemoLocalWorkflow(hashSharedPayload(JSON.stringify(toSharedPayload(frame.data))))
    }
    setStorageAvailable(saveOperationsState(frame.data))
  }, [frame.data])

  const refreshSharedState = useCallback(async () => {
    const config = latestData.current.partnerApp
    if (readDemoAdminSession() || !hasFirebaseAdminSession() || config.mode !== 'firestore' || !config.projectId.trim()) {
      setSharedState({ status: 'local', lastSyncedAt: null, updatedBy: null, error: null })
      return
    }
    // Background polls should not flicker the Settings status when the state
    // is already synced or a save is in progress.
    setSharedState((current) => ['loading', 'saving', 'synced'].includes(current.status)
      ? current
      : { ...current, status: 'loading', error: null })
    try {
      const remote = await loadSharedWorkflow(config, readPartnerAppToken(), latestData.current)
      const localPayload = JSON.stringify(toSharedPayload(latestData.current))
      const localHash = hashSharedPayload(localPayload)
      const demoLocalWorkflow = hasDemoLocalWorkflow(localHash)
      if (!remote) {
        if (demoLocalWorkflow) {
          // Never seed the shared workflow with demo sample data. The operator
          // must clear the demo leftovers before a real Firebase session.
          setSharedReady(false)
          setSharedState({
            status: 'error',
            lastSyncedAt: null,
            updatedBy: null,
            error: 'This browser still contains demo workflow data. Sign out, clear this site’s local data, then sign in again before using the shared Firebase workflow.',
          })
          return
        }
        lastSavedPayload.current = ''
        remoteRevision.current = 0
        setSharedReady(true)
        setSharedState({ status: 'synced', lastSyncedAt: null, updatedBy: null, error: null })
        return
      }
      if (demoLocalWorkflow) {
        // The remote shared workflow is authoritative; discard the demo
        // workflow and its live caches instead of uploading them.
        const remotePayload = JSON.stringify(toSharedPayload(remote.state))
        remoteRevision.current = remote.revision
        lastSavedPayload.current = remotePayload
        writeSharedWorkflowMeta({ revision: remote.revision, payloadHash: hashSharedPayload(remotePayload), savedAt: new Date().toISOString() })
        const hydrated = mergeSharedPayload(latestData.current, remote.state)
        hydrated.partnerAppRecords = []
        hydrated.partnerAppTickets = []
        hydrated.partnerAppDocuments = []
        hydrated.partnerApp = { ...hydrated.partnerApp, lastSyncAt: null, lastConnectedAt: null, lastError: null }
        hydrateGuard.current = true
        dispatch({ type: 'state.hydrate', state: hydrated })
        clearDemoLocalWorkflow()
        setSharedReady(true)
        setSharedState({ status: 'synced', lastSyncedAt: remote.updatedAt, updatedBy: remote.updatedBy, error: null })
        return
      }
      const meta = readSharedWorkflowMeta()
      const localHasData = latestData.current.deliveries.length > 0
        || latestData.current.partners.length > 0
        || latestData.current.applications.length > 0
        || latestData.current.auditLogs.length > 0
      const localHasUnsavedChanges = meta
        ? meta.payloadHash !== localHash
        : localHasData
      if (localHasUnsavedChanges) {
        // A refresh can happen before the debounced shared write completes.
        // Keep the local workflow and push it instead of restoring stale Firestore data.
        remoteRevision.current = remote.revision
        lastSavedPayload.current = ''
        setSharedReady(true)
        setSharedState({ status: 'saving', lastSyncedAt: remote.updatedAt, updatedBy: remote.updatedBy, error: null })
        setSaveTick((value) => value + 1)
        return
      }
      if (remote.revision === remoteRevision.current) {
        setSharedReady(true)
        setSharedState({ status: 'synced', lastSyncedAt: remote.updatedAt, updatedBy: remote.updatedBy, error: null })
        return
      }
      remoteRevision.current = remote.revision
      const remotePayload = JSON.stringify(toSharedPayload(remote.state))
      // A newer revision can still contain identical shared data. Keep the
      // local view and its live caches instead of forcing a needless render.
      if (hashSharedPayload(remotePayload) === localHash) {
        lastSavedPayload.current = remotePayload
        writeSharedWorkflowMeta({ revision: remote.revision, payloadHash: localHash, savedAt: new Date().toISOString() })
        setSharedReady(true)
        setSharedState({ status: 'synced', lastSyncedAt: remote.updatedAt, updatedBy: remote.updatedBy, error: null })
        return
      }
      lastSavedPayload.current = remotePayload
      writeSharedWorkflowMeta({ revision: remote.revision, payloadHash: hashSharedPayload(remotePayload), savedAt: new Date().toISOString() })
      // Hydrated audit history has already been written by the administrator
      // who created it. Never replay those decisions into delivery_app.
      // Merge into the latest state, not the snapshot from when the request
      // started, so a partner sync or identity refresh that landed meanwhile
      // is not replaced by older live caches.
      hydrateGuard.current = true
      dispatch({ type: 'state.hydrate', state: mergeSharedPayload(latestData.current, remote.state) })
      setSharedReady(true)
      setSharedState({ status: 'synced', lastSyncedAt: remote.updatedAt, updatedBy: remote.updatedBy, error: null })
    } catch (error) {
      setSharedReady(false)
      setSharedState({
        status: 'error',
        lastSyncedAt: null,
        updatedBy: null,
        error: error instanceof Error ? error.message : 'Shared workflow state could not be loaded.',
      })
    }
  }, [])

  useEffect(() => {
    if (!sharedReady || readDemoAdminSession() || !hasFirebaseAdminSession()) return
    const config = frame.data.partnerApp
    if (config.mode !== 'firestore' || !config.projectId.trim()) return
    const payload = JSON.stringify(toSharedPayload(frame.data))
    if (payload === lastSavedPayload.current) return
    const timer = window.setTimeout(async () => {
      setSharedState((current) => ({ ...current, status: 'saving', error: null }))
      try {
        const revision = await saveSharedWorkflow(config, readPartnerAppToken(), frame.data, frame.data.user.name || 'Administrator')
        lastSavedPayload.current = payload
        remoteRevision.current = revision
        const savedAt = new Date().toISOString()
        writeSharedWorkflowMeta({ revision, payloadHash: hashSharedPayload(payload), savedAt })
        clearDemoLocalWorkflow()
        setSharedState({ status: 'synced', lastSyncedAt: savedAt, updatedBy: frame.data.user.name, error: null })
      } catch (error) {
        setSharedState((current) => ({ ...current, status: 'error', error: error instanceof Error ? error.message : 'Shared workflow state could not be saved.' }))
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [frame.data, sharedReady, saveTick])

  // Refresh and tab-close can race the debounced write. Flush a small shared
  // payload with keepalive before the page goes away.
  useEffect(() => {
    if (!sharedReady || readDemoAdminSession() || !hasFirebaseAdminSession()) return
    const config = frame.data.partnerApp
    if (config.mode !== 'firestore' || !config.projectId.trim()) return
    const flush = () => {
      const payload = JSON.stringify(toSharedPayload(frame.data))
      if (payload === lastSavedPayload.current) return
      void saveSharedWorkflow(config, readPartnerAppToken(), frame.data, frame.data.user.name || 'Administrator', true)
        .then((revision) => {
          lastSavedPayload.current = payload
          remoteRevision.current = revision
          writeSharedWorkflowMeta({ revision, payloadHash: hashSharedPayload(payload), savedAt: new Date().toISOString() })
          clearDemoLocalWorkflow()
        })
        .catch(() => {
          // The normal debounced save remains the retry path.
        })
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [frame.data, sharedReady])

  useEffect(() => {
    if (!sharedReady || readDemoAdminSession() || !hasFirebaseAdminSession()) return
    const timer = window.setInterval(() => { void refreshSharedState() }, 60_000)
    return () => window.clearInterval(timer)
  }, [sharedReady, refreshSharedState])

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

        const orders = live.map((item) => ({
          id: item.id,
          displayId: item.displayId,
          partnerUid: item.partnerUid,
          partnerName: item.partnerName,
          nativeStatus: item.nativeStatus,
          withdrawn: item.withdrawn,
          category: item.category === 'Restaurant' ? 'Restaurant' as const : 'Grocery' as const,
          pickup: item.pickup,
          destination: item.destination,
          distanceKm: item.distanceKm,
          etaMinutes: item.etaMinutes,
          earnings: item.earnings,
          itemCount: item.itemCount,
          paymentMode: item.paymentMode === 'Cash on delivery' ? 'Cash on delivery' as const : 'Prepaid' as const,
          note: item.note,
          dropOtp: item.dropOtp,
          requestedAt: item.requestedAt,
          acceptedAt: item.acceptedAt,
          completedAt: item.completedAt,
          updatedAt: item.updatedAt,
          cancellationReason: item.cancellationReason,
          events: item.events,
          rejected: item.partnerResponse?.decision === 'rejected',
        }))

        if (orders.length) {
          dispatch({ type: 'delivery.sync-live-orders', at: new Date().toISOString(), orders })
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
          customerName: intent.customerName,
          customerPhone: intent.customerPhone,
          orderValue: intent.orderValue,
          collectAmount: intent.collectAmount,
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
      } else if (intent.kind === 'delivery-unassign') {
        await writeDeliveryUnassign({
          config,
          token: readPartnerAppToken(),
          deliveryId: intent.deliveryId,
          partnerAppUid: intent.partnerAppUid,
          reason: intent.reason,
          at: intent.at,
        })
      } else if (intent.kind === 'delivery-details') {
        await writeDeliveryDetails({
          config,
          token: readPartnerAppToken(),
          deliveryId: intent.deliveryId,
          partnerAppUid: intent.partnerAppUid,
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
          customerName: intent.customerName,
          customerPhone: intent.customerPhone,
          orderValue: intent.orderValue,
          collectAmount: intent.collectAmount,
          note: intent.note,
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
          : intent.kind === 'delivery-details'
            ? 'Delivery details published to the partner app.'
            : intent.kind === 'delivery-cancel'
              ? 'Cancellation published to the partner app.'
              : intent.kind === 'delivery-unassign'
                ? 'Unassigned offer withdrawn from the partner app.'
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
    if (hydrateGuard.current) {
      hydrateGuard.current = false
      processedLogs.current = new Set(logs.map((log) => log.id))
      return
    }
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
    () => ({ frame, dispatch, storageAvailable, partnerAppWriteFailures, retryPartnerAppWrites, sharedState, refreshSharedState }),
    [frame, storageAvailable, partnerAppWriteFailures, retryPartnerAppWrites, sharedState, refreshSharedState],
  )
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>
}

export function useOperations() {
  const context = useContext(OperationsContext)
  if (!context) throw new Error('useOperations must be used inside OperationsProvider')
  return context
}

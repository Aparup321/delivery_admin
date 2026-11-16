import { useEffect, useRef } from 'react'
import type { AdminSession } from '../auth/adminSession'
import { readPartnerAppToken, syncPartnerAppRecords } from '../services/partnerApp'
import { readFirebaseAdminSession } from '../services/firebaseAuth'
import { useOperations } from '../state/OperationsProvider'

/**
 * Loads delivery_app partner records automatically after a real Firebase
 * sign-in, the way a normal admin console would. Demo access keeps the seeded
 * sample partners instead of contacting Firestore.
 */
export function useAutoPartnerSync(session: AdminSession) {
  const { frame, dispatch } = useOperations()
  const attempted = useRef<string | null>(null)

  useEffect(() => {
    if (session.mode !== 'Firebase Authentication') return
    if (!readFirebaseAdminSession()) return
    const config = frame.data.partnerApp
    const configured = config.mode === 'firestore'
      ? Boolean(config.projectId.trim() && config.partnersCollection.trim())
      : Boolean(config.endpointUrl.trim())
    if (!configured) return
    if (config.lastSyncAt && Date.now() - new Date(config.lastSyncAt).getTime() < 5 * 60_000) return

    const key = `${session.userId}:${config.mode}:${config.projectId}:${config.partnersCollection}:${config.endpointUrl}`
    if (attempted.current === key) return
    attempted.current = key

    void (async () => {
      try {
        const records = await syncPartnerAppRecords(config, readPartnerAppToken())
        dispatch({ type: 'partnerApp.sync-result', records, at: new Date().toISOString() })
      } catch (error) {
        dispatch({
          type: 'partnerApp.failed',
          message: error instanceof Error ? error.message : 'Automatic partner sync failed.',
        })
      }
    })()
  }, [session.mode, session.userId, frame.data.partnerApp, dispatch])
}

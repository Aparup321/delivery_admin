import { useState } from 'react'
import { beginFirebaseDataConnection } from '../auth/adminSession'
import { hasFirebaseEnvConfig } from '../config/firebase'
import { userCan } from '../domain/admin'
import { readFirebaseAdminSession } from '../services/firebaseAuth'
import { readPartnerAppToken, syncPartnerAppRecords, syncPartnerAppTickets } from '../services/partnerApp'
import { Button, formatDate, Icon } from './ui'
import { useOperations } from '../state/OperationsProvider'

export function PartnerAppSettings() {
  const { frame, dispatch } = useOperations()
  const saved = frame.data.partnerApp
  const canManage = userCan(frame.data.user, 'settings')
  const firebaseSession = readFirebaseAdminSession()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null)
  const configured = saved.mode === 'firestore'
    ? Boolean(saved.projectId.trim() && saved.partnersCollection.trim())
    : Boolean(saved.endpointUrl.trim())

  async function syncNow() {
    if (!canManage) return
    if (!firebaseSession) {
      setNotice({ kind: 'info', message: 'Demo access uses the built-in sample partners. Sign in with a real Firebase account to sync live records.' })
      return
    }
    if (!configured) {
      setNotice({ kind: 'error', message: 'The Firebase partner connection is not configured. Add VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_PARTNERS_COLLECTION to .env.local.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const token = readPartnerAppToken()
      const [records, tickets] = await Promise.all([
        syncPartnerAppRecords(saved, token),
        syncPartnerAppTickets(saved, token).catch(() => []),
      ])
      dispatch({ type: 'partnerApp.sync-result', records, tickets, at: new Date().toISOString() })
      setNotice(records.length > 0
        ? { kind: 'success', message: `${records.length} partner record${records.length === 1 ? '' : 's'} loaded from delivery_app.` }
        : { kind: 'info', message: 'The connection worked, but the collection returned 0 records. Check the collection name and Firestore rules.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Partner data sync failed.'
      dispatch({ type: 'partnerApp.failed', message })
      setNotice({ kind: 'error', message })
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="settings-section-title"><strong>Partner records</strong><span>delivery_app → delivery_admin</span></div>
    <div className="settings-note"><Icon name={firebaseSession ? 'check-circle' : 'info'} size={15} /><span>{firebaseSession ? <>Connected as <strong>{firebaseSession.email}</strong>. Live partner data syncs automatically; the console identity stays unchanged.</> : 'Demo access is active. Connect a Firebase administrator to load live partner records without leaving the demo console.'}</span></div>

    <div className="partner-app-status">
      <div><span>Connection</span><strong>{firebaseSession ? 'Firebase Authentication' : 'Demo access'}</strong></div>
      <div><span>Project</span><strong>{saved.mode === 'firestore' ? saved.projectId || 'Not configured' : 'Custom REST endpoint'}</strong></div>
      <div><span>Last sync</span><strong>{saved.lastSyncAt ? formatDate(saved.lastSyncAt) : 'Not synced'}</strong></div>
      <div><span>Cached partners</span><strong>{frame.data.partnerAppRecords.length}</strong></div>
    </div>

    {!hasFirebaseEnvConfig && <div className="partner-app-notice error"><Icon name="alert" size={14} /><span className="partner-app-notice-copy">Firebase is not configured. Add <strong>VITE_FIREBASE_PROJECT_ID</strong> and <strong>VITE_FIREBASE_API_KEY</strong> to <strong>.env.local</strong>, then restart the app.</span></div>}
    {saved.lastError && notice?.message !== saved.lastError && <div className="partner-app-notice error"><Icon name="alert" size={14} /><span className="partner-app-notice-copy">{saved.lastError}</span></div>}
    {notice && <div className={`partner-app-notice ${notice.kind}`}><Icon name={notice.kind === 'error' ? 'alert' : notice.kind === 'success' ? 'check-circle' : 'info'} size={14} /><span className="partner-app-notice-copy">{notice.message}</span></div>}

    {!canManage && <div className="settings-note"><Icon name="lock" size={15} /><span>Your account has read-only Settings access. A main administrator must grant the <strong>Change settings</strong> action to connect the partner backend or sync from this screen.</span></div>}
    <div className="partner-app-actions">
      {firebaseSession
        ? <Button variant="primary" onClick={syncNow} disabled={!canManage || busy || !configured}>
          <Icon name="refresh" size={14} />{busy ? 'Syncing…' : 'Sync partner data'}
        </Button>
        : <Button variant="primary" onClick={beginFirebaseDataConnection} disabled={!canManage || !hasFirebaseEnvConfig}>
          <Icon name="lock" size={14} />Sign in to load live partners
        </Button>}
      <span className="field-help">{firebaseSession ? 'No token or project fields are needed. The signed-in Firebase account is used automatically.' : 'Demo records are local samples. Sign in with the Firebase administrator account to read the live partners collection.'}</span>
    </div>
    <div className="settings-note"><Icon name="lock" size={15} /><span>Reads and live account actions use the same Firebase project as delivery_app. Firestore rules must allow the signed-in administrator UID.</span></div>
  </>
}

import { useEffect, useState } from 'react'
import type { PartnerAppConfig, PartnerAppMode } from '../domain/model'
import { firebaseWebConfig, hasFirebaseEnvConfig } from '../config/firebase'
import { Button, formatDate, Icon } from './ui'
import { useOperations } from '../state/OperationsProvider'
import { PartnerAppRequestError, clearPartnerAppToken, parseFirebaseConfigJson, partnerAppEndpoint, readPartnerAppToken, storePartnerAppToken, syncPartnerAppRecords, testPartnerAppConnection } from '../services/partnerApp'
import { clearFirebaseAdminSession, readFirebaseAdminSession, signInFirebaseAdmin, type FirebaseAdminSession } from '../services/firebaseAuth'

type Draft = Pick<PartnerAppConfig, 'mode' | 'projectId' | 'apiKey' | 'databaseId' | 'partnersCollection' | 'endpointUrl'>

function draftFrom(config: PartnerAppConfig): Draft {
  return {
    mode: config.mode,
    projectId: config.projectId,
    apiKey: config.apiKey,
    databaseId: config.databaseId,
    partnersCollection: config.partnersCollection,
    endpointUrl: config.endpointUrl,
  }
}

export function PartnerAppSettings() {
  const { frame, dispatch, partnerAppWriteFailures, retryPartnerAppWrites } = useOperations()
  const saved = frame.data.partnerApp
  const savedSnapshot = JSON.stringify(draftFrom(saved))
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved))
  const [token, setToken] = useState(() => readPartnerAppToken())
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null)
  const [firebaseEmail, setFirebaseEmail] = useState('admin@picdrop.demo')
  const [firebasePassword, setFirebasePassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [adminSession, setAdminSession] = useState<FirebaseAdminSession | null>(() => readFirebaseAdminSession())
  const [configText, setConfigText] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; message: string; url?: string } | null>(null)
  const canManage = frame.data.user.role === 'Admin'
  const dirty = JSON.stringify(draft) !== savedSnapshot
  const configured = saved.mode === 'firestore'
    ? Boolean(saved.projectId.trim() && saved.partnersCollection.trim())
    : Boolean(saved.endpointUrl.trim())
  let savedRequestUrl = ''
  try {
    savedRequestUrl = partnerAppEndpoint(saved, 300)
  } catch {
    savedRequestUrl = ''
  }

  useEffect(() => {
    setDraft(draftFrom(saved))
  }, [savedSnapshot])

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setNotice(null)
  }

  function updateToken(value: string) {
    setToken(value)
    storePartnerAppToken(value)
    setNotice(null)
  }

  async function signInAdmin() {
    const apiKey = saved.apiKey.trim() || firebaseWebConfig.apiKey.trim() || draft.apiKey.trim()
    setAuthBusy(true)
    setNotice(null)
    try {
      const session = await signInFirebaseAdmin(firebaseEmail, firebasePassword, apiKey)
      setAdminSession(session)
      setFirebasePassword('')
      if (partnerAppWriteFailures > 0) retryPartnerAppWrites()
      setNotice({ kind: 'success', message: `Signed in to Firebase as ${session.email}.${partnerAppWriteFailures > 0 ? ` Retrying ${partnerAppWriteFailures} failed delivery_app update${partnerAppWriteFailures === 1 ? '' : 's'}.` : ' Approve, reject, suspend, and restore actions now write to delivery_app.'}` })
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Firebase administrator sign-in failed.' })
    } finally {
      setAuthBusy(false)
    }
  }

  function signOutAdmin() {
    clearFirebaseAdminSession()
    setAdminSession(null)
    setNotice({ kind: 'info', message: 'Firebase administrator session cleared from this browser tab.' })
  }

  function applyConfigText(text: string) {
    try {
      const config = parseFirebaseConfigJson(text)
      setDraft((current) => ({
        ...current,
        mode: 'firestore',
        projectId: config.projectId,
        apiKey: config.apiKey,
        databaseId: config.databaseId ?? '',
      }))
      setNotice({ kind: 'success', message: `Imported Firebase project "${config.projectId}". Save the connection, then test it.` })
      return true
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Could not read the Firebase config.' })
      return false
    }
  }

  function loadEnvDefaults() {
    setDraft((current) => ({
      ...current,
      mode: 'firestore',
      projectId: firebaseWebConfig.projectId,
      apiKey: firebaseWebConfig.apiKey,
      databaseId: firebaseWebConfig.firestoreDatabaseId,
      partnersCollection: firebaseWebConfig.partnersCollection,
    }))
    setNotice({ kind: 'info', message: 'Loaded Firebase values from .env.local. Save the connection to persist them.' })
  }

  async function copyRequestUrl() {
    if (!savedRequestUrl) return
    if (!navigator.clipboard) {
      setNotice({ kind: 'error', message: 'Clipboard access is unavailable in this browser. Select the URL manually.' })
      return
    }
    try {
      await navigator.clipboard.writeText(savedRequestUrl)
      setNotice({ kind: 'info', message: 'Request URL copied to the clipboard.' })
    } catch {
      setNotice({ kind: 'error', message: 'Could not copy the request URL. Select it manually.' })
    }
  }

  function validate(): string | null {
    if (draft.mode === 'firestore') {
      if (!draft.projectId.trim()) return 'Enter the Firebase project ID for the delivery_app backend.'
      if (!draft.partnersCollection.trim()) return 'Enter the Firestore collection that stores delivery partners.'
      return null
    }
    try {
      const url = new URL(draft.endpointUrl.trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'The REST endpoint must start with http:// or https://.'
    } catch {
      return 'Enter a valid REST endpoint URL that returns partner JSON.'
    }
    return null
  }

  function save() {
    const problem = validate()
    if (problem) {
      setNotice({ kind: 'error', message: problem })
      return
    }
    dispatch({ type: 'partnerApp.save', config: { ...draft } })
    setNotice({ kind: 'success', message: 'Connection saved. Test the connection or sync partner data.' })
  }

  async function testConnection() {
    if (dirty || !configured) {
      setNotice({ kind: 'info', message: 'Save the connection details before testing.' })
      return
    }
    setBusy('test')
    setNotice(null)
    try {
      const message = await testPartnerAppConnection(saved, token)
      dispatch({ type: 'partnerApp.connected', at: new Date().toISOString() })
      setNotice({ kind: 'success', message })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Partner app connection failed.'
      const requestUrl = error instanceof PartnerAppRequestError ? error.requestUrl : savedRequestUrl
      dispatch({ type: 'partnerApp.failed', message })
      setNotice({ kind: 'error', message, url: requestUrl })
    } finally {
      setBusy(null)
    }
  }

  async function syncData() {
    if (dirty || !configured) {
      setNotice({ kind: 'info', message: 'Save the connection details before syncing.' })
      return
    }
    setBusy('sync')
    setNotice(null)
    try {
      const records = await syncPartnerAppRecords(saved, token)
      dispatch({ type: 'partnerApp.sync-result', records, at: new Date().toISOString() })
      setNotice(records.length > 0
        ? { kind: 'success', message: `${records.length} partner app record${records.length === 1 ? '' : 's'} synced. Open Partners → Partner app to review them.` }
        : { kind: 'info', message: 'The request succeeded but returned 0 records. Check the partners collection name and Firestore read rules.', url: savedRequestUrl })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Partner app sync failed.'
      const requestUrl = error instanceof PartnerAppRequestError ? error.requestUrl : savedRequestUrl
      dispatch({ type: 'partnerApp.failed', message })
      setNotice({ kind: 'error', message, url: requestUrl })
    } finally {
      setBusy(null)
    }
  }

  return <>
    <div className="settings-section-title"><strong>delivery_admin → delivery_app</strong><span>Connect this admin app to the same Firebase project as delivery_app. Connection details stay in this browser's demo data.</span></div>
    {hasFirebaseEnvConfig && <div className="settings-note"><Icon name="check-circle" size={15} /><span>Firebase defaults loaded from <strong>.env.local</strong> for project <strong>{firebaseWebConfig.projectId}</strong>. Fields below are prefilled and can be overridden here. Restart the dev server after editing <strong>.env.local</strong>.</span></div>}
    <div className="settings-note"><Icon name="info" size={15} /><span>In the Firebase project delivery_app already uses, open <strong>Project settings → Your apps → Add app → Web</strong> and register <strong>delivery_admin</strong>, then paste its config below. Firestore reads only need the project ID and API key, so delivery_app's config also works. Set the collection delivery_app writes, then save and test.</span></div>
    <div className="settings-section-title"><strong>Firebase administrator sign-in</strong><span>Firestore rules allow this account to read and write delivery_app partner records. The session stays in this browser tab; the password is never stored.</span></div>
    {adminSession ? <>
      <div className="partner-app-status">
        <div><span>Signed in</span><strong>{adminSession.email}</strong></div>
        <div><span>Firebase UID</span><strong>{adminSession.uid}</strong></div>
        <div><span>Token expires</span><strong>{formatDate(new Date(adminSession.expiresAt).toISOString())}</strong></div>
        <div><span>Live account writes</span><strong>Enabled</strong></div>
      </div>
      <div className="partner-app-actions">
        <Button variant="danger" onClick={signOutAdmin} disabled={!canManage}>Sign out of Firebase</Button>
        <span className="field-help">Signing out stops live writes until the next Firebase sign-in. The pasted ID token below is separate.</span>
      </div>
    </> : <div className="partner-app-form">
      <label className="field-label">Administrator email<input value={firebaseEmail} disabled={!canManage || authBusy} onChange={(event) => { setFirebaseEmail(event.target.value); setNotice(null) }} placeholder="admin@picdrop.demo" autoComplete="username" /><span className="field-help">Use the Firebase Authentication account whose UID is allowed in delivery_app/firestore.rules.</span></label>
      <label className="field-label">Password<input type="password" value={firebasePassword} disabled={!canManage || authBusy} onChange={(event) => { setFirebasePassword(event.target.value); setNotice(null) }} placeholder="Firebase administrator password" autoComplete="current-password" /></label>
      <div className="firebase-import-row full-width"><span>The demo project uses <strong>admin@picdrop.demo</strong>. Change that password in Firebase Authentication after setup, then sign in again here.</span><Button variant="primary" onClick={signInAdmin} disabled={!canManage || authBusy || !firebaseEmail.trim() || !firebasePassword}>{authBusy ? 'Signing in…' : 'Sign in to Firebase'}</Button></div>
    </div>}
    <div className="partner-app-form">
      {draft.mode === 'firestore' && <div className="firebase-import full-width"><label className="field-label">Paste delivery_admin Firebase config<textarea rows={4} value={configText} disabled={!canManage} onChange={(event) => { setConfigText(event.target.value); setNotice(null) }} onPaste={(event) => { const text = event.clipboardData.getData('text'); event.preventDefault(); setConfigText(text); applyConfigText(text) }} placeholder={`{\n  "apiKey": "AIza…",\n  "authDomain": "delivery-app.firebaseapp.com",\n  "projectId": "delivery-app",\n  "storageBucket": "delivery-app.appspot.com",\n  "messagingSenderId": "…",\n  "appId": "…"\n}`} spellCheck={false} /><span className="field-help">Use the config from the delivery_admin Web app in the same project as delivery_app. Only projectId, apiKey, and an optional firestoreDatabaseId are used for Firestore reads.</span></label><div className="firebase-import-row"><span>Pasting fills the fields automatically. Your current partners collection is kept.</span><Button size="small" onClick={() => applyConfigText(configText)} disabled={!canManage || !configText.trim()}>Auto-fill fields</Button></div></div>}
      <label className="field-label">Connection type<select value={draft.mode} disabled={!canManage} onChange={(event) => update('mode', event.target.value as PartnerAppMode)}><option value="firestore">Firebase Firestore (delivery_app)</option><option value="endpoint">Custom REST endpoint</option></select></label>
      <div className="partner-app-mode-note"><span>{draft.mode === 'firestore' ? 'Reads partners directly from a Firestore collection using the REST API.' : 'Reads any JSON endpoint that returns partner records.'}</span></div>
      {draft.mode === 'firestore' ? <>
        <label className="field-label">Firebase project ID<input value={draft.projectId} disabled={!canManage} onChange={(event) => update('projectId', event.target.value)} placeholder="delivery-app-12345" autoComplete="off" /><span className="field-help">{hasFirebaseEnvConfig ? 'Prefilled from VITE_FIREBASE_PROJECT_ID in .env.local.' : 'Set VITE_FIREBASE_PROJECT_ID in .env.local or enter it here.'}</span></label>
        <label className="field-label">Web API key<input value={draft.apiKey} disabled={!canManage} onChange={(event) => update('apiKey', event.target.value)} placeholder="AIza… (optional with an ID token)" autoComplete="off" /><span className="field-help">{firebaseWebConfig.apiKey ? 'Prefilled from VITE_FIREBASE_API_KEY in .env.local. You can override it here.' : 'Set VITE_FIREBASE_API_KEY in .env.local or paste the web API key here.'}</span></label>
        <label className="field-label">Firestore database<input value={draft.databaseId} disabled={!canManage} onChange={(event) => update('databaseId', event.target.value)} placeholder="(default)" autoComplete="off" /></label>
        <label className="field-label">Partners collection<input value={draft.partnersCollection} disabled={!canManage} onChange={(event) => update('partnersCollection', event.target.value)} placeholder="partners" autoComplete="off" /><span className="field-help">The collection delivery_app writes partner records to. Default: partners.</span></label>
      </> : <label className="field-label full-width">REST endpoint URL<input value={draft.endpointUrl} disabled={!canManage} onChange={(event) => update('endpointUrl', event.target.value)} placeholder="https://firestore.googleapis.com/… or your delivery_app API" autoComplete="off" /></label>}
      <label className="field-label full-width">Firebase ID token (optional)<input type="password" value={token} disabled={!canManage} onChange={(event) => updateToken(event.target.value)} placeholder="Optional when the Firebase administrator above is signed in" autoComplete="off" /><span className="field-help">The signed-in administrator supplies this automatically. A pasted token overrides it. Kept in sessionStorage for this browser tab only — never written to demo data, audit entries, or local storage.</span></label>
    </div>
    <div className="partner-app-request"><div><span>Request URL</span><code>{savedRequestUrl || 'Configure and save the connection to preview the request URL.'}</code></div>{savedRequestUrl && <Button size="small" variant="quiet" onClick={copyRequestUrl}>Copy URL</Button>}</div>
    <div className="partner-app-status">
      <div><span>Firebase project</span><strong>{saved.mode === 'firestore' ? saved.projectId || 'Not configured' : saved.endpointUrl ? 'Custom REST endpoint' : 'Not configured'}</strong></div>
      <div><span>Last verified</span><strong>{saved.lastConnectedAt ? formatDate(saved.lastConnectedAt) : 'Never'}</strong></div>
      <div><span>Last sync</span><strong>{saved.lastSyncAt ? formatDate(saved.lastSyncAt) : 'Never'}</strong></div>
      <div><span>Cached records</span><strong>{frame.data.partnerAppRecords.length}</strong></div>
    </div>
    {saved.lastError && notice?.message !== saved.lastError && <div className="partner-app-notice error"><Icon name="alert" size={14} /><span className="partner-app-notice-copy">{saved.lastError}{savedRequestUrl && <small className="partner-app-error-url">Request: {savedRequestUrl}</small>}</span></div>}
    {notice && <div className={`partner-app-notice ${notice.kind}`}><Icon name={notice.kind === 'error' ? 'alert' : notice.kind === 'success' ? 'check-circle' : 'info'} size={14} /><span className="partner-app-notice-copy">{notice.message}{notice.url && <small className="partner-app-error-url">Request: {notice.url}</small>}</span></div>}
    {notice?.kind === 'error' && <p className="partner-app-error-hint">403 usually means the Firestore rules rejected the read, or the API key is restricted to delivery_app's domains — allow this admin origin (localhost or the deployed delivery_admin URL). “Failed to fetch” usually means CORS or network access; 404 means the project, database, or collection is wrong.</p>}
    <div className="partner-app-actions">
      <Button variant="primary" onClick={save} disabled={!canManage || !dirty} title={!canManage ? 'Administrator access required' : undefined}><Icon name="check" size={14} />Save connection</Button>
      <Button onClick={testConnection} disabled={!canManage || dirty || !configured || busy !== null}>{busy === 'test' ? 'Testing…' : 'Test connection'}</Button>
      <Button onClick={syncData} disabled={!canManage || dirty || !configured || busy !== null}><Icon name="refresh" size={14} />{busy === 'sync' ? 'Syncing…' : 'Sync partner data'}</Button>
      {hasFirebaseEnvConfig && <Button variant="quiet" onClick={loadEnvDefaults} disabled={!canManage}>Load .env.local values</Button>}
      {token && <Button variant="quiet" onClick={() => { clearPartnerAppToken(); setToken(''); setNotice({ kind: 'info', message: 'Session token removed from this browser tab.' }) }}>Forget token</Button>}
      {dirty && <span className="unsaved-indicator"><i />Unsaved connection changes</span>}
    </div>
    <div className="settings-note"><Icon name="info" size={15} /><span>Reads and live account writes use the Firebase project shared with delivery_app. delivery_admin does not need its own Firestore database; a second web app is only required for Firebase Auth, Storage, or per-app analytics. The project must allow this origin and its security rules must permit the admin UID. The administrator session refreshes automatically and is cleared when the browser tab closes. Up to 300 records are cached per sync.</span></div>
  </>
}

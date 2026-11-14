import { useEffect, useMemo, useState } from 'react'
import type { AdminSession } from '../auth/adminSession'
import { DEMO_ADMIN_PERMISSIONS } from '../domain/admin'
import type { NotificationCategory, OperationsSettings, OperationsState } from '../domain/model'
import { Button, Dialog, formatDate, Icon, initials, Panel, PanelHeading, StatusBadge } from '../components/ui'
import { PartnerAppSettings } from '../components/PartnerAppSettings'
import { useOperations } from '../state/OperationsProvider'

const tabs = ['Operations', 'Assignment rules', 'Notifications', 'Partner app', 'Admin access', 'Demo data'] as const
type SettingsTab = (typeof tabs)[number]
const notificationCategories: NotificationCategory[] = ['Delivery Assigned', 'Delivery Delayed', 'Unassigned Delivery', 'Assignment Offer Expired', 'Partner Rejected Offer', 'Delivery Completed', 'Partner Restricted', 'Partner Suspended', 'Document Expired', 'Verification Required', 'Partner Application Approved', 'Partner Application Rejected']

function cloneSettings(settings: OperationsSettings) {
  return structuredClone(settings)
}

export function SettingsPage({ data, session, onOpenAccount, initialTab }: { data: OperationsState; session: AdminSession; onOpenAccount: () => void; initialTab?: string }) {
  const { frame, dispatch } = useOperations()
  const [tab, setTab] = useState<SettingsTab>(() => initialTab === 'partner-app' ? 'Partner app' : 'Operations')
  const [draft, setDraft] = useState(() => cloneSettings(data.settings))
  const [resetOpen, setResetOpen] = useState(false)
  const settingsSnapshot = JSON.stringify(data.settings)
  const isDirty = useMemo(() => JSON.stringify(draft) !== settingsSnapshot, [draft, settingsSnapshot])
  const canManage = frame.data.user.role === 'Admin'

  useEffect(() => setDraft(cloneSettings(data.settings)), [settingsSnapshot])
  useEffect(() => {
    const key = 'picdrop-demo-settings-dirty'
    if (isDirty) window.sessionStorage.setItem(key, '1')
    else window.sessionStorage.removeItem(key)
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  function update<K extends keyof OperationsSettings>(key: K, value: OperationsSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateNotification(category: NotificationCategory, enabled: boolean) {
    setDraft((current) => ({ ...current, notifications: { ...current.notifications, [category]: enabled } }))
  }

  function discard() {
    setDraft(cloneSettings(data.settings))
  }

  return <div className="page-stack settings-page">
    <div className="settings-layout">
      <Panel className="settings-sidebar"><span className="settings-sidebar-label">CONFIGURATION</span>{tabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}><Icon name={item === 'Operations' ? 'settings' : item === 'Assignment rules' ? 'route' : item === 'Notifications' ? 'notifications' : item === 'Partner app' ? 'external' : item === 'Admin access' ? 'lock' : 'refresh'} size={16} />{item}</button>)}<div className="settings-side-note"><Icon name="info" size={14} />All settings apply to this browser’s demo data only.</div></Panel>
      <Panel className="settings-content">
        <PanelHeading title={tab} detail={tab === 'Operations' ? 'Offer and exception rules for local simulations.' : tab === 'Assignment rules' ? 'Eligibility requirements used by the shared assignment engine.' : tab === 'Notifications' ? 'Choose which demo events create an in-app notification.' : tab === 'Partner app' ? 'Connect delivery_admin to the same Firebase project as delivery_app and sync partner records.' : tab === 'Admin access' ? 'The signed-in Administrator account and its demo permissions.' : 'Manage data stored in this browser.'} action={isDirty && tab !== 'Partner app' && <span className="unsaved-indicator"><i />Unsaved changes</span>} />

        {tab === 'Operations' && <div className="settings-section">
          <div className="settings-section-title"><strong>Assignment offer lifecycle</strong><span>Used for simulated partner offers only.</span></div>
          <div className="setting-row"><div><strong>Offer timeout</strong><span>Time before an awaiting demo offer expires.</span></div><label className="setting-control"><input aria-label="Offer timeout in minutes" type="number" min="1" max="60" value={draft.offerTimeoutMinutes} onChange={(event) => update('offerTimeoutMinutes', Number(event.target.value))} disabled={!canManage} /><small>minutes</small></label></div>
          <div className="setting-row"><div><strong>Maximum assignment attempts</strong><span>Offer attempts before the delivery remains in the dispatch queue.</span></div><label className="setting-control"><input aria-label="Maximum assignment attempts" type="number" min="1" max="10" value={draft.maxAssignmentAttempts} onChange={(event) => update('maxAssignmentAttempts', Number(event.target.value))} disabled={!canManage} /><small>attempts</small></label></div>
          <div className="setting-row"><div><strong>Enable next-partner fallback</strong><span>When enabled, a timeout may offer to the next eligible partner. No assignment happens automatically.</span></div><button className={`toggle ${draft.fallbackEnabled ? 'toggle-on' : ''}`} role="switch" aria-checked={draft.fallbackEnabled} aria-label="Enable next partner fallback" disabled={!canManage} onClick={() => update('fallbackEnabled', !draft.fallbackEnabled)}><i /></button></div>
          <div className="setting-row"><div><strong>Fallback behaviour</strong><span>Fallback only runs when the explicit enable switch is on.</span></div><select className="setting-select" value={draft.fallbackBehavior} disabled={!canManage || !draft.fallbackEnabled} onChange={(event) => update('fallbackBehavior', event.target.value as OperationsSettings['fallbackBehavior'])}><option>Next eligible partner</option><option>Return to dispatch queue</option><option value="Notify operations manager">Notify Administrator</option></select></div>
          <div className="settings-section-title settings-separator"><strong>Operational exceptions</strong><span>Thresholds are informational in the local demo.</span></div>
          <div className="setting-row"><div><strong>Delay threshold</strong><span>Scheduled end exceeded before a delay alert is considered due.</span></div><label className="setting-control"><input aria-label="Delay threshold in minutes" type="number" min="1" max="180" value={draft.delayThresholdMinutes} onChange={(event) => update('delayThresholdMinutes', Number(event.target.value))} disabled={!canManage} /><small>minutes</small></label></div>
          <div className="settings-note"><Icon name="info" size={15} /><span>Delay status is still an explicit operator action. The demo does not invent a customer price or automatically change deliveries.</span></div>
        </div>}

        {tab === 'Assignment rules' && <div className="settings-section">
          <div className="settings-section-title"><strong>Eligibility checks</strong><span>Hard requirements are enforced by the shared business logic and cannot be disabled here.</span></div>
          <div className="rule-check-list">{[
            ['Verification complete', 'All configured mandatory documents must be verified and unexpired.'],
            ['Partner availability', 'Offline, restricted, suspended, and already assigned partners are blocked.'],
            ['Vehicle compatibility', 'Package size and vehicle type must be compatible.'],
            ['Service area match', 'Partner must cover at least the pickup or drop service area.'],
            ['Assignment capacity', 'A partner cannot hold another incompatible active delivery.'],
          ].map(([title, detail]) => <div className="rule-check-row" key={title}><span className="rule-check"><Icon name="check" size={14} /></span><div><strong>{title}</strong><small>{detail}</small></div><span className="required-tag">REQUIRED</span></div>)}</div>
          <div className="settings-section-title settings-separator"><strong>Mandatory documents</strong><span>A missing, rejected, expired, or pending record blocks assignment.</span></div>
          <div className="required-document-list">{draft.requiredDocuments.map((document) => <span key={document}><Icon name="file" size={15} />{document}<i>Mandatory</i></span>)}</div>
          <div className="settings-note"><Icon name="shield" size={15} /><span>Current demo data contains both eligible and ineligible partners so operations can inspect the reasons.</span></div>
        </div>}

        {tab === 'Notifications' && <div className="settings-section">
          <div className="settings-section-title"><strong>In-app notification categories</strong><span>Events remain in audit history even when a category notification is disabled.</span></div>
          {notificationCategories.map((category) => <div className="setting-row setting-row-compact" key={category}><div><strong>{category}</strong><span>Show in the local notification centre when this event is recorded.</span></div><button className={`toggle ${draft.notifications[category] ? 'toggle-on' : ''}`} role="switch" aria-checked={draft.notifications[category]} aria-label={`${category} notifications`} disabled={!canManage} onClick={() => updateNotification(category, !draft.notifications[category])}><i /></button></div>)}
          <div className="settings-note"><Icon name="info" size={15} /><span>No email, SMS, push, or third-party delivery notifications are connected.</span></div>
        </div>}

        {tab === 'Partner app' && <div className="settings-section"><PartnerAppSettings /></div>}

        {tab === 'Admin access' && <div className="settings-section">
          <div className="settings-section-title"><strong>Signed-in Administrator</strong><span>The Operations team has one account with full access to this demo console.</span></div>
          <div className="admin-access-card">
            <div className="admin-access-identity">
              <span className="profile-large-avatar admin-account-avatar">{initials(frame.data.user.name)}</span>
              <div><strong>{frame.data.user.name}</strong><small>{frame.data.user.title}</small><span>{frame.data.user.email}</span></div>
              <StatusBadge status={frame.data.user.role} />
            </div>
            <div className="admin-access-facts">
              <div><span>Account ID</span><strong>{frame.data.user.id}</strong></div>
              <div><span>Administrative role</span><strong>Admin</strong></div>
              <div><span>Contact</span><strong>{frame.data.user.maskedPhone}</strong></div>
              <div><span>Signed in</span><strong>{formatDate(session.signedInAt)}</strong></div>
              <div><span>Access method</span><strong>{session.mode}</strong></div>
              <div><span>Session scope</span><strong>This browser tab</strong></div>
            </div>
            <div className="admin-access-actions"><Button size="small" onClick={onOpenAccount}><Icon name="user" size={14} />Open account details</Button></div>
          </div>
          <div className="settings-section-title settings-separator"><strong>Administrator permissions</strong><span>Actions are checked in the shared operations layer as well as the interface.</span></div>
          <ul className="admin-permission-list">{DEMO_ADMIN_PERMISSIONS.map((permission) => <li key={permission}><span><Icon name="check" size={12} /></span>{permission}</li>)}</ul>
          <div className="settings-note"><Icon name="lock" size={15} /><span>This local demo sign-in is simulated and is not connected to an identity provider, SSO, or production authorization service.</span></div>
        </div>}

        {tab === 'Demo data' && <div className="settings-section">
          <div className="settings-section-title"><strong>Local demo environment</strong><span>Records are stored in this browser using localStorage.</span></div>
          <div className="demo-data-summary"><div><span>Environment</span><strong><StatusBadge status="DEMO" /></strong></div><div><span>Deliveries</span><strong>{data.deliveries.length}</strong></div><div><span>Partners</span><strong>{data.partners.length}</strong></div><div><span>Audit events</span><strong>{data.auditLogs.length}</strong></div><div><span>Backend integrations</span><strong>{data.partnerApp.lastSyncAt ? 'Partner app connected' : data.partnerApp.projectId || data.partnerApp.endpointUrl ? 'Partner app configured' : 'None connected'}</strong></div></div>
          <div className="settings-note"><Icon name="info" size={15} /><span>Reset restores sample deliveries, partners, documents, notifications, and settings. This cannot be undone.</span></div>
          <div className="reset-data-row"><div><strong>Reset demo data</strong><span>Discard local changes and restore the initial illustrative records.</span></div><Button variant="danger" disabled={!canManage} onClick={() => setResetOpen(true)}><Icon name="refresh" size={15} />Reset demo data</Button></div>
        </div>}

        {tab !== 'Admin access' && tab !== 'Demo data' && tab !== 'Partner app' && <div className="settings-footer"><div><span>{canManage ? isDirty ? 'Changes have not been saved.' : 'Changes are stored locally after saving.' : `${frame.data.user.role} has read-only access to configuration.`}</span></div><div><Button onClick={discard} disabled={!canManage || !isDirty}>Discard</Button><Button variant="primary" disabled={!canManage || !isDirty} onClick={() => dispatch({ type: 'settings.save', settings: draft })}>Save changes</Button></div></div>}
      </Panel>
    </div>

    {resetOpen && <Dialog title="Reset demo data?" onClose={() => setResetOpen(false)}>
      <div className="dialog-form"><p className="dialog-description">This replaces locally stored demo records with the original sample data. Delivery changes, partner verification, offers, read states, and settings will be lost. Audit history will record the reset.</p><div className="dialog-actions"><Button onClick={() => setResetOpen(false)}>Keep my data</Button><Button variant="danger" onClick={() => { dispatch({ type: 'demo.reset' }); setDraft(cloneSettings(data.settings)); setResetOpen(false) }}>Reset all demo data</Button></div></div>
    </Dialog>}
  </div>
}

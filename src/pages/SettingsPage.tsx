import { useEffect, useMemo, useState } from 'react'
import type { OperationsSettings, OperationsState } from '../domain/model'
import { Button, Icon, Panel, PanelHeading } from '../components/ui'
import { PartnerAppSettings } from '../components/PartnerAppSettings'
import { userCan } from '../domain/admin'
import { useOperations } from '../state/OperationsProvider'

const tabs = ['General', 'Partner sync'] as const
type SettingsTab = (typeof tabs)[number]

function tabFrom(initialTab?: string): SettingsTab {
  if (initialTab === 'partner-app' || initialTab === 'partner') return 'Partner sync'

  return 'General'
}

function cloneSettings(settings: OperationsSettings) {
  return structuredClone(settings)
}

export function SettingsPage({ data, initialTab }: { data: OperationsState; initialTab?: string }) {
  const { frame, dispatch } = useOperations()
  const [tab, setTab] = useState<SettingsTab>(() => tabFrom(initialTab))
  const [draft, setDraft] = useState(() => cloneSettings(data.settings))

  const settingsSnapshot = JSON.stringify(data.settings)
  const isDirty = useMemo(() => JSON.stringify(draft) !== settingsSnapshot, [draft, settingsSnapshot])
  const canManage = userCan(frame.data.user, 'settings')

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

  return <div className="page-stack settings-page">
    <div className="settings-layout">
      <Panel className="settings-sidebar">
        <span className="settings-sidebar-label">CONFIGURATION</span>
        {tabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
          <Icon name={item === 'General' ? 'settings' : item === 'Partner sync' ? 'external' : 'refresh'} size={16} />{item}
        </button>)}
        <div className="settings-side-note"><Icon name="info" size={14} />Simple controls for the manager walkthrough.</div>
      </Panel>

      <Panel className="settings-content">
        <PanelHeading
          title={tab}
          detail={tab === 'General' ? 'Offer rules and the delay threshold.' : tab === 'Partner sync' ? 'Partner records load automatically after Firebase sign-in.' : 'Seeded partners and deliveries used in the demo.'}
          action={isDirty && tab === 'General' && <span className="unsaved-indicator"><i />Unsaved changes</span>}
        />

        {tab === 'General' && <>
          <div className="settings-section">
            <div className="settings-section-title"><strong>Assignment offers</strong><span>These settings control the local demo workflow.</span></div>
            <div className="setting-row"><div><strong>Offer timeout</strong><span>Minutes before an awaiting partner offer expires.</span></div><label className="setting-control"><input aria-label="Offer timeout in minutes" type="number" min="1" max="60" value={draft.offerTimeoutMinutes} onChange={(event) => update('offerTimeoutMinutes', Number(event.target.value))} disabled={!canManage} /><small>minutes</small></label></div>
            <div className="setting-row"><div><strong>Maximum attempts</strong><span>Offer attempts before the delivery returns to dispatch.</span></div><label className="setting-control"><input aria-label="Maximum assignment attempts" type="number" min="1" max="10" value={draft.maxAssignmentAttempts} onChange={(event) => update('maxAssignmentAttempts', Number(event.target.value))} disabled={!canManage} /><small>attempts</small></label></div>
            <div className="setting-row"><div><strong>Next-partner fallback</strong><span>Allow a timed-out offer to move to the next eligible partner.</span></div><button className={`toggle ${draft.fallbackEnabled ? 'toggle-on' : ''}`} role="switch" aria-checked={draft.fallbackEnabled} aria-label="Enable next partner fallback" disabled={!canManage} onClick={() => update('fallbackEnabled', !draft.fallbackEnabled)}><i /></button></div>
            <div className="setting-row"><div><strong>Delay alert</strong><span>Minutes past the scheduled end before a delay is considered due.</span></div><label className="setting-control"><input aria-label="Delay threshold in minutes" type="number" min="1" max="180" value={draft.delayThresholdMinutes} onChange={(event) => update('delayThresholdMinutes', Number(event.target.value))} disabled={!canManage} /><small>minutes</small></label></div>
          </div>
          <div className="settings-note"><Icon name="shield" size={15} /><span>Verification, availability, vehicle, and service-area checks are enforced automatically. They are not configurable in this demo.</span></div>
          <div className="settings-footer"><div><span>{canManage ? isDirty ? 'Changes have not been saved.' : 'Changes are stored locally after saving.' : `${frame.data.user.role} has read-only access.`}</span></div><div><Button onClick={() => setDraft(cloneSettings(data.settings))} disabled={!canManage || !isDirty}>Discard</Button><Button variant="primary" disabled={!canManage || !isDirty} onClick={() => dispatch({ type: 'settings.save', settings: draft })}>Save changes</Button></div></div>
        </>}

        {tab === 'Partner sync' && <div className="settings-section"><PartnerAppSettings /></div>}


      </Panel>
    </div>

  </div>
}

import { useEffect, useState, type FormEvent } from 'react'
import { userCan } from '../domain/admin'
import type { OperationsState, Partner } from '../domain/model'
import { nextPartnerId } from '../domain/operations'
import { Button, formatDate, Icon, Panel, PanelHeading } from '../components/ui'
import { useOperations } from '../state/OperationsProvider'

export function PartnerCreatePage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const { frame, dispatch } = useOperations()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [vehicle, setVehicle] = useState<Partner['vehicle']>('Bike')
  const [areas, setAreas] = useState('')
  const [registration, setRegistration] = useState('')
  const [note, setNote] = useState('')
  const [createdId, setCreatedId] = useState<string | null>(null)
  const canCreate = userCan(frame.data.user, 'partner-management')
  const nextId = nextPartnerId(data)
  const created = createdId ? data.partners.find((partner) => partner.id === createdId) : undefined
  const recent = [...data.partners].sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).slice(0, 5)

  useEffect(() => {
    if (!created) return
    setName('')
    setPhone('')
    setEmail('')
    setVehicle('Bike')
    setAreas('')
    setRegistration('')
    setNote('')
  }, [created?.id])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canCreate) return
    const partnerId = nextPartnerId(data)
    dispatch({ type: 'partner.create', partnerId, name, phone, email, vehicle, serviceAreas: areas.split(','), registrationLast4: registration, note })
    setCreatedId(partnerId)
  }

  return <div className="page-stack">
    {created && <div className="soft-notice"><Icon name="check-circle" size={15} /><span><strong>{created.id} · {created.name}</strong> is offline. Mandatory documents are missing and must be verified before assignment.</span><Button size="small" variant="primary" onClick={() => open(`/admin/partners/${created.id}`)}>Open profile</Button></div>}
    <div className="profile-columns">
      <div className="profile-main-column">
        <Panel>
          <PanelHeading title="Create a new partner" detail={`Next partner ID · ${nextId}`} />
          <form className="partner-create-form" onSubmit={submit}>
            <p className="dialog-description">Create an admin partner record. New partners start offline with every mandatory KYC document marked missing.</p>
            {!canCreate && <div className="settings-note"><Icon name="lock" size={15} /><span>Your {frame.data.user.role} account can view partner records but cannot create them. Ask a main administrator for partner-management access.</span></div>}
            <div className="form-grid two-columns">
              <label className="field-label span-two">Full name<input autoFocus value={name} disabled={!canCreate} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="e.g. Rohan Mitra" /></label>
              <label className="field-label">Phone number<input type="tel" value={phone} disabled={!canCreate} onChange={(event) => setPhone(event.target.value)} required minLength={7} maxLength={20} placeholder="+91 98765 43210" /><span className="field-help">Stored masked in the directory.</span></label>
              <label className="field-label">Email address<input type="email" value={email} disabled={!canCreate} onChange={(event) => setEmail(event.target.value)} maxLength={120} placeholder="Optional" /></label>
              <label className="field-label">Vehicle<select value={vehicle} disabled={!canCreate} onChange={(event) => setVehicle(event.target.value as Partner['vehicle'])}><option>Bike</option><option>Scooter</option><option>Van</option></select></label>
              <label className="field-label">Registration last 4 digits<input inputMode="numeric" pattern="[0-9]{4}" value={registration} disabled={!canCreate} onChange={(event) => setRegistration(event.target.value.replace(/\D/g, '').slice(0, 4))} maxLength={4} placeholder="Optional · 1234" /><span className="field-help">Stored masked as WB-••-1234.</span></label>
              <label className="field-label span-two">Service areas<input value={areas} disabled={!canCreate} onChange={(event) => setAreas(event.target.value)} required placeholder="Barasat, New Town, Rajarhat" /><span className="field-help">Separate multiple areas with commas. At least one area is required.</span></label>
              <label className="field-label span-two">Internal note (optional)<textarea rows={2} value={note} disabled={!canCreate} onChange={(event) => setNote(event.target.value)} maxLength={240} placeholder="Why this partner is being added" /></label>
            </div>
            <div className="dialog-actions"><Button type="submit" variant="primary" disabled={!canCreate} title={canCreate ? undefined : 'Partner management access required'}><Icon name="plus" size={15} />Create partner</Button></div>
          </form>
        </Panel>
      </div>
      <aside className="profile-side-column">
        <Panel>
          <PanelHeading title="What happens next" detail="Defaults applied to every new partner" />
          <div className="settings-section">
            <div className="setting-row"><div><strong>Offline by default</strong><span>The partner cannot receive offers until an operator makes them available.</span></div></div>
            <div className="setting-row"><div><strong>Mandatory documents missing</strong><span>{data.settings.requiredDocuments.join(', ')} are created as missing records.</span></div></div>
            <div className="setting-row"><div><strong>KYC review required</strong><span>Open the partner profile to review documents and verify the account.</span></div></div>
            <div className="settings-note"><Icon name="info" size={15} /><span>This creates an admin directory record only. delivery_app accounts still sign up in the partner app; link the account from Partners → Partner app after it appears in a sync.</span></div>
          </div>
        </Panel>
        <Panel>
          <PanelHeading title="Recently added partners" detail="Newest directory records" action={<Button size="small" variant="quiet" onClick={() => open('/admin/partners')}>Directory</Button>} />
          <div className="attention-list">{recent.map((partner) => <button className="attention-row" key={partner.id} onClick={() => open(`/admin/partners/${partner.id}`)}><span className="attention-icon attention-purple"><Icon name="partners" size={15} /></span><span><b>{partner.name}</b><small>{partner.id} · {partner.availability} · Added {formatDate(partner.registeredAt, { month: 'short', day: 'numeric' })}</small></span><Icon name="chevron" size={15} /></button>)}</div>
        </Panel>
      </aside>
    </div>
  </div>
}

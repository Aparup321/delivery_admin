import { useMemo, useState } from 'react'
import type { Delivery, OperationsState, Partner } from '../domain/model'
import { getPartnerEligibility } from '../domain/operations'
import { Button, Dialog, EmptyState, Icon, PageHeading, Panel, PanelHeading, StatusBadge } from '../components/ui'
import { useOperations } from '../state/OperationsProvider'

interface Props {
  data: OperationsState
  delivery: Delivery
  open: (path: string) => void
}

export function AssignmentPage({ data, delivery, open }: Props) {
  const { frame, dispatch } = useOperations()
  const [tab, setTab] = useState<'Eligible' | 'Ineligible'>('Eligible')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const now = Date.now()
  const evaluations = useMemo(() => data.partners.map((partner) => ({ partner, ...getPartnerEligibility(data, partner, delivery, now) })), [data, delivery, now])
  const matches = (partner: Partner) => !query.trim() || `${partner.id} ${partner.name} ${partner.vehicle} ${partner.serviceAreas.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())
  const eligible = evaluations.filter((entry) => entry.eligible && matches(entry.partner))
  const ineligible = evaluations.filter((entry) => !entry.eligible && matches(entry.partner))
  const entries = tab === 'Eligible' ? eligible : ineligible
  const selectedEntry = evaluations.find((entry) => entry.partner.id === selectedId && entry.eligible)
  const assigned = delivery.assignmentId ? data.assignments.find((item) => item.id === delivery.assignmentId && item.status === 'Active') : undefined
  const canAssign = ['Admin', 'Operations Manager', 'Operations Staff'].includes(frame.data.user.role)

  function confirmAssignment() {
    if (!selectedEntry) return
    dispatch({ type: 'delivery.assign', deliveryId: delivery.id, partnerId: selectedEntry.partner.id })
    setConfirm(false)
  }

  function createOffer() {
    if (!selectedEntry) return
    dispatch({ type: 'offer.create', deliveryId: delivery.id, partnerId: selectedEntry.partner.id })
    open(`/admin/deliveries/${delivery.id}`)
  }

  return <div className="page-stack assignment-page">
    <PageHeading title={`Assign partner · ${delivery.id}`} subtitle="Eligibility is calculated from current demo documents, partner availability, vehicle, service area, and active assignments." breadcrumbs={[{ label: 'Overview', path: '/admin' }, { label: 'Deliveries', path: '/admin/deliveries' }, { label: delivery.id, path: `/admin/deliveries/${delivery.id}` }, { label: 'Assignment' }]} onNavigate={open} />
    <div className="assignment-summary-strip"><span><Icon name="pin" size={15} /><b>{delivery.pickup}</b><Icon name="arrow" size={13} /><b>{delivery.drop}</b></span><i /><span><Icon name="deliveries" size={15} />{delivery.packageSize} · {delivery.estimatedWeightKg.toFixed(1)} kg</span><i /><span><Icon name="calendar" size={15} />{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(delivery.scheduledStart))} – {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(delivery.scheduledEnd))}</span><i /><span>Vehicle: <b>{delivery.vehicleRequirement}</b></span>{assigned && <><i /><span className="reassign-label">Reassigning from {data.partners.find((item) => item.id === assigned.partnerId)?.name}</span></>}</div>

    {delivery.status === 'Delayed' && <div className="exception-banner"><Icon name="alert" size={17} /><div><strong>This delivery is delayed</strong><span>Assignment changes are allowed, but the delay and current milestone remain unchanged.</span></div></div>}
    {['Completed', 'Cancelled'].includes(delivery.status) && <EmptyState title={`This delivery is ${delivery.status.toLowerCase()}`} detail="Completed or cancelled deliveries cannot be assigned. Return to the delivery record to review its history." action={<Button onClick={() => open(`/admin/deliveries/${delivery.id}`)}>Back to delivery</Button>} />}

    {!['Completed', 'Cancelled'].includes(delivery.status) && <div className="assignment-workspace">
      <Panel className="candidate-panel">
        <div className="partner-tabs"><button className={tab === 'Eligible' ? 'active' : ''} onClick={() => setTab('Eligible')}>Eligible <span>{eligible.length}</span></button><button className={tab === 'Ineligible' ? 'active' : ''} onClick={() => setTab('Ineligible')}>Ineligible <span>{ineligible.length}</span></button></div>
        <div className="candidate-tools"><label className="search-control"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search partner, vehicle, or service area" aria-label="Search partners" /></label><span>Eligibility checked at {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(now)}</span></div>
        <div className="table-scroll"><table className="data-table candidate-table"><thead><tr><th></th><th>Partner</th><th>Vehicle</th><th>Service area</th><th>Availability</th><th>Verification</th><th>Current assignment</th><th>Eligibility / reason</th></tr></thead><tbody>
          {entries.map(({ partner, reasons, eligible: canTake, validDocuments, requiredDocuments, currentAssignment }) => {
            const active = currentAssignment ? data.deliveries.find((item) => item.id === currentAssignment) : null
            const verified = validDocuments === requiredDocuments
            return <tr key={partner.id} onClick={() => canTake && setSelectedId(partner.id)} className={`${canTake && selectedId === partner.id ? 'candidate-selected' : ''} ${!canTake ? 'candidate-ineligible' : ''}`}>
              <td><input type="radio" name="partner" checked={canTake && selectedId === partner.id} disabled={!canTake} onChange={() => setSelectedId(partner.id)} aria-label={`Select ${partner.name}`} /></td>
              <td><span className="partner-cell"><span className="mini-avatar">{partner.name.split(' ').map((part) => part[0]).join('').replace('.', '')}</span><span><b>{partner.name}</b><small>{partner.id}</small></span></span></td>
              <td><span className="vehicle-cell"><Icon name={partner.vehicle === 'Bike' ? 'bike' : partner.vehicle === 'Van' ? 'van' : 'scooter'} size={16} />{partner.vehicle}</span></td>
              <td><span className="area-list">{partner.serviceAreas.slice(0, 2).join(', ')}{partner.serviceAreas.length > 2 && <small>+{partner.serviceAreas.length - 2} areas</small>}</span></td>
              <td><StatusBadge status={partner.availability} /></td>
              <td><span className={`verification-compact ${verified ? 'verified' : 'not-verified'}`}><Icon name={verified ? 'check-circle' : 'alert'} size={14} />{verified ? 'Verified' : `${validDocuments}/${requiredDocuments} valid`}</span></td>
              <td>{active ? <button className="table-record-link" onClick={(event) => { event.stopPropagation(); open(`/admin/deliveries/${active.id}`) }}>{active.id}</button> : <span className="muted-text">None</span>}</td>
              <td>{canTake ? <StatusBadge status="Eligible" /> : <span className="eligibility-reasons" title={reasons.join('\n')}>{reasons.slice(0, 2).join(' · ')}{reasons.length > 2 && <small>+{reasons.length - 2} reasons</small>}</span>}</td>
            </tr>
          })}
        </tbody></table>{entries.length === 0 && <EmptyState title={tab === 'Eligible' ? 'No eligible partners found' : 'No ineligible partners match'} detail={tab === 'Eligible' ? 'Change the search or review vehicle and area requirements. Ineligibility reasons are available on the other tab.' : 'Try a broader search.'} />}</div>
        <div className="candidate-footnote"><Icon name="info" size={14} />Mandatory documents, active assignments, status, vehicle fit, and service area are always checked by the shared assignment engine.</div>
      </Panel>

      <aside className="assignment-side">
        <Panel className="assignment-confirm-panel">
          <PanelHeading title="Assignment confirmation" detail="Review before updating shared demo records" />
          <div className="assignment-summary-card"><span className="summary-card-label">DELIVERY</span><strong>{delivery.id}</strong><span>{delivery.pickup} <Icon name="arrow" size={12} /> {delivery.drop}</span><small>{delivery.packageSize} · {delivery.vehicleRequirement} requirement</small></div>
          {selectedEntry ? <div className="selected-partner-card"><span className="profile-large-avatar">{selectedEntry.partner.name.split(' ').map((part) => part[0]).join('').replace('.', '')}</span><div><span className="summary-card-label">SELECTED PARTNER</span><strong>{selectedEntry.partner.name}</strong><small>{selectedEntry.partner.id} · {selectedEntry.partner.vehicle}</small><small>Service areas: {selectedEntry.partner.serviceAreas.join(', ')}</small><StatusBadge status="Eligible" /></div></div> : <div className="select-partner-hint"><span className="empty-icon"><Icon name="partners" /></span><strong>Select an eligible partner</strong><small>Ineligible partners cannot be assigned. Their reasons are shown in the table.</small></div>}
          <div className="assignment-effects"><span>On confirmation</span><ul><li>Partner availability updates</li><li>Assignment history is retained</li><li>Audit record is appended</li><li>Overview and notifications refresh</li></ul></div>
          <Button variant="primary" className="full-width" disabled={!selectedEntry || !canAssign} title={!canAssign ? 'Read-only operational access' : undefined} onClick={() => setConfirm(true)}>{assigned ? 'Confirm reassignment' : 'Confirm assignment'}<Icon name="arrow" size={15} /></Button>
          <Button className="full-width" disabled={!selectedEntry || !canAssign || Boolean(assigned)} onClick={createOffer}><Icon name="clock" size={15} />Create simulated partner offer</Button>
          <p className="demo-disclaimer-small">Offers are local simulations. No partner is contacted. Fallback remains disabled unless enabled in Settings.</p>
        </Panel>
        <Panel className="assignment-policy"><PanelHeading title="Demo offer policy" /><div className="policy-row"><span>Offer timeout</span><strong>{data.settings.offerTimeoutMinutes} min</strong></div><div className="policy-row"><span>Max attempts</span><strong>{data.settings.maxAssignmentAttempts}</strong></div><div className="policy-row"><span>Fallback</span><StatusBadge status={data.settings.fallbackEnabled ? 'Available' : 'Offline'} /></div><button className="text-link" onClick={() => open('/admin/settings')}>Review demo settings <Icon name="arrow" size={14} /></button></Panel>
      </aside>
    </div>}

    {confirm && selectedEntry && <Dialog title={assigned ? 'Confirm partner reassignment' : 'Confirm partner assignment'} onClose={() => setConfirm(false)}>
      <div className="dialog-form"><p className="dialog-description">This demo action updates the delivery and partner records together. Previous assignments remain in the history.</p><div className="confirm-summary"><span>Delivery<strong>{delivery.id} · {delivery.pickup} → {delivery.drop}</strong></span><span>Partner<strong>{selectedEntry.partner.id} · {selectedEntry.partner.name}</strong></span>{assigned && <span>Previous partner<strong>{data.partners.find((item) => item.id === assigned.partnerId)?.name ?? assigned.partnerId}</strong></span>}</div><div className="dialog-actions"><Button onClick={() => setConfirm(false)}>Review again</Button><Button variant="primary" onClick={confirmAssignment}>Confirm assignment</Button></div></div>
    </Dialog>}
  </div>
}

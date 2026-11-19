import { useEffect, useMemo, useState } from 'react'
import { userCan } from '../domain/admin'
import { DELIVERY_MILESTONES, type Delivery, type OperationsState } from '../domain/model'
import { hasServiceAreaCoordinate, serviceAreaCoordinate } from '../domain/serviceAreas'
import { MapPreview } from '../components/MapPreview'
import { Button, ConfirmDialog, formatDate, Icon, Panel, PanelHeading, StatusBadge } from '../components/ui'
import { useOperations } from '../state/OperationsProvider'

interface Props {
  data: OperationsState
  delivery: Delivery
  open: (path: string) => void
}

function timeLeft(expiresAt: string, now: number) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now)
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor(remaining % 60_000 / 1_000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function DeliveryDetailPage({ data, delivery, open }: Props) {
  const { frame, dispatch } = useOperations()
  const [dialog, setDialog] = useState<'cancel' | 'delay' | 'resolve' | string | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const history = data.assignments.filter((assignment) => assignment.deliveryId === delivery.id).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
  const currentAssignment = history.find((assignment) => assignment.status === 'Active')
  const assignedPartner = currentAssignment ? data.partners.find((partner) => partner.id === currentAssignment.partnerId) : undefined
  const offers = data.offers.filter((offer) => offer.deliveryId === delivery.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const nextMilestone = delivery.milestones.findIndex((milestone) => !milestone.completedAt)
  const isTerminal = delivery.status === 'Completed' || delivery.status === 'Cancelled'
  const canOperate = userCan(frame.data.user, 'assignment')
  const canManage = userCan(frame.data.user, 'delivery-management')
  const mapRoute = useMemo(() => ({
    approximate: !hasServiceAreaCoordinate(delivery.pickup) || !hasServiceAreaCoordinate(delivery.drop),
    points: [
      { id: `${delivery.id}-pickup`, label: `Pickup · ${delivery.pickup}`, ...serviceAreaCoordinate(delivery.pickup), kind: 'pickup' as const },
      { id: `${delivery.id}-drop`, label: `Drop · ${delivery.drop}`, ...serviceAreaCoordinate(delivery.drop), kind: 'drop' as const },
    ],
  }), [delivery.id, delivery.pickup, delivery.drop])

  return <div className="page-stack detail-page">
    <div className="detail-action-bar">
      <div className="detail-state"><span className="record-id-large">{delivery.id}</span><StatusBadge status={delivery.status} /><span className="created-label">Created {formatDate(delivery.createdAt)}</span></div>
      <div className="detail-actions"><Button size="small" variant="secondary" onClick={() => open(`/admin/deliveries/${delivery.id}/assign`)} disabled={!canOperate || isTerminal} title={!canOperate ? 'Read-only operational access' : undefined}><Icon name="route" size={15} />{currentAssignment ? 'Reassign' : 'Assign partner'}</Button>
        {delivery.status === 'Delayed' ? <Button size="small" onClick={() => setDialog('resolve')} disabled={!canManage}>Resolve delay</Button> : <Button size="small" onClick={() => setDialog('delay')} disabled={!canManage || isTerminal}>Mark delayed</Button>}
        <Button size="small" variant="danger" onClick={() => setDialog('cancel')} disabled={!canManage || isTerminal}>Cancel delivery</Button>
      </div>
    </div>

    {delivery.status === 'Delayed' && <div className="exception-banner"><Icon name="alert" size={17} /><div><strong>Delivery delayed · underlying milestone preserved</strong><span>{delivery.delayReason || 'No reason recorded.'} · Current progress: {delivery.milestones.filter((item) => item.completedAt).length} of 6 milestones</span></div></div>}
    {assignedPartner?.needsOperationalReview && <div className="exception-banner exception-review"><Icon name="shield" size={17} /><div><strong>Partner requires an operational review</strong><span>The partner’s availability changed while this assignment was active. Assignment history is preserved; review the operational handoff.</span></div></div>}

    <div className="detail-main-grid">
      <div className="detail-left-column">
        <Panel>
          <PanelHeading title="Delivery information" detail="Local record" />
          <div className="detail-info-grid">
            <div className="detail-info-item"><span>Pickup</span><strong><Icon name="pin" size={15} />{delivery.pickup}</strong><small>{delivery.pickupAddress}</small></div>
            <div className="detail-info-item"><span>Drop</span><strong><Icon name="pin" size={15} />{delivery.drop}</strong><small>{delivery.dropAddress}</small></div>
            <div className="detail-info-item"><span>Package</span><strong><Icon name="deliveries" size={15} />{delivery.packageSize} · {delivery.estimatedWeightKg.toFixed(1)} kg</strong><small>Vehicle requirement: {delivery.vehicleRequirement}</small></div>
            <div className="detail-info-item"><span>Scheduled window</span><strong><Icon name="calendar" size={15} />{formatDate(delivery.scheduledStart)} — {formatDate(delivery.scheduledEnd)}</strong><small>Times are local schedule values</small></div>
            <div className="detail-info-item detail-instructions"><span>Special instructions</span><strong>{delivery.specialInstructions || 'No special instructions'}</strong><small>No customer-sensitive data is connected.</small></div>
          </div>
        </Panel>

        <Panel>
          <PanelHeading title="Route map" detail="OpenStreetMap preview · no live GPS" />
          <MapPreview points={mapRoute.points} ariaLabel={`OpenStreetMap preview from ${delivery.pickup} to ${delivery.drop}`} />
          <p className="osm-map-footnote"><Icon name="info" size={13} />Tiles are shared with delivery_app. {mapRoute.approximate ? 'Some area coordinates are approximate. ' : ''}Routing, live partner location and ETA are not connected.</p>
        </Panel>

        <Panel className="milestone-panel">
          <PanelHeading title="Delivery milestones" detail={`${delivery.milestones.filter((item) => item.completedAt).length} of 6 recorded`} action={!isTerminal && <Button size="small" variant="primary" disabled={!canOperate || delivery.status === 'Delayed' || !currentAssignment || nextMilestone < 0} onClick={() => dispatch({ type: 'delivery.advance', deliveryId: delivery.id })}>{nextMilestone === 5 ? 'Mark as delivered' : nextMilestone > -1 ? `Record ${DELIVERY_MILESTONES[nextMilestone]}` : 'Complete'}<Icon name="arrow" size={14} /></Button>} />
          <div className="milestone-list">{delivery.milestones.map((milestone, index) => {
            const complete = Boolean(milestone.completedAt)
            const current = !complete && index === nextMilestone && !isTerminal
            return <div key={milestone.name} className={`milestone-row ${complete ? 'milestone-done' : ''} ${current ? 'milestone-current' : ''}`}>
              <div className="milestone-track"><span className="milestone-marker">{complete ? <Icon name="check" size={12} /> : current ? <i /> : <span />}</span>{index < delivery.milestones.length - 1 && <span className="milestone-line" />}</div>
              <div className="milestone-copy"><div><strong>{milestone.name}</strong>{current && <span className="current-step-tag">NEXT</span>}</div><small>{complete ? `${formatDate(milestone.completedAt)} · ${milestone.completedBy}` : current ? 'Ready to record' : 'Not yet recorded'}</small></div>
              <span className={`milestone-state ${complete ? 'state-complete' : current ? 'state-current' : ''}`}>{complete ? 'Complete' : current ? 'In progress' : 'Upcoming'}</span>
            </div>
          })}</div>
          <p className="milestone-note"><Icon name="info" size={14} />Milestones are manually simulated. No live GPS events or partner app updates are connected.</p>
        </Panel>

        <Panel>
          <PanelHeading title="Assignment offers" detail={`${offers.length} recorded attempt${offers.length === 1 ? '' : 's'} · offer lifecycle`} action={!isTerminal && !currentAssignment && <Button size="small" onClick={() => open(`/admin/deliveries/${delivery.id}/assign`)}><Icon name="plus" size={14} />Create an offer</Button>} />
          {offers.length ? <div className="offer-list">{offers.map((offer) => {
            const offerPartner = data.partners.find((partner) => partner.id === offer.partnerId)
            const isActive = offer.status === 'Awaiting Response'
            return <div className="offer-row" key={offer.id}>
              <div className="offer-main"><span className="offer-avatar">{offerPartner?.name.split(' ').map((part) => part[0]).join('').replace('.', '') ?? 'DP'}</span><div><strong>{offer.id} <StatusBadge status={offer.status} /></strong><small>{delivery.id} · {offerPartner?.id} {offerPartner?.name ?? 'Partner unavailable'} · attempt {offer.attempt}</small><div className="offer-states">{offer.stateHistory.map((step, index) => <span className={step.status === offer.status ? 'offer-state-current' : ''} key={`${step.status}-${index}`} title={formatDate(step.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}>{step.status}{index < offer.stateHistory.length - 1 && <i />}</span>)}</div>{offer.note && <small className="offer-note">{offer.note}</small>}</div></div>
              <div className="offer-time"><small>{isActive ? 'Time remaining · simulated' : 'Created'}</small><strong className={isActive && new Date(offer.expiresAt).getTime() - now < 60_000 ? 'text-danger' : ''}>{isActive ? timeLeft(offer.expiresAt, now) : formatDate(offer.respondedAt ?? offer.createdAt, { hour: 'numeric', minute: '2-digit' })}</strong></div>
              <div className="offer-actions">
                {offer.status === 'Created' && <Button size="small" variant="primary" disabled={!canOperate} onClick={() => dispatch({ type: 'offer.send', offerId: offer.id })}>Send offer</Button>}
                {isActive && <><Button size="small" variant="primary" disabled={!canOperate} onClick={() => dispatch({ type: 'offer.accept', offerId: offer.id })}>Accept</Button><Button size="small" variant="quiet" disabled={!canOperate} onClick={() => setDialog(offer.id)}>Reject</Button><Button size="small" variant="quiet" disabled={!canManage} onClick={() => dispatch({ type: 'offer.expire', offerId: offer.id })}>Simulate timeout</Button></>}
              </div>
            </div>
          })}</div> : <div className="inline-empty"><Icon name="clock" size={18} /><span><strong>No offers recorded</strong><small>Partner offers you create will appear here with their response and timeout history.</small></span></div>}
        </Panel>
      </div>

      <div className="detail-right-column">
        <Panel className="current-assignment-panel">
          <PanelHeading title="Current assignment" detail={currentAssignment ? 'Active assignment' : 'No active assignment'} />
          {currentAssignment && assignedPartner ? <>
            <button className="profile-summary-link" onClick={() => open(`/admin/partners/${assignedPartner.id}`)}><span className="profile-large-avatar">{assignedPartner.name.split(' ').map((part) => part[0]).join('').replace('.', '')}</span><span><strong>{assignedPartner.name}</strong><small>{assignedPartner.id}</small></span><Icon name="external" size={15} /></button>
            <div className="assignment-facts"><div><span>Vehicle</span><strong>{assignedPartner.vehicle}</strong></div><div><span>Service area</span><strong>{assignedPartner.serviceAreas.join(', ')}</strong></div><div><span>Assignment status</span><strong><StatusBadge status={currentAssignment.status} /></strong></div><div><span>Assigned at</span><strong>{formatDate(currentAssignment.assignedAt)}</strong></div><div><span>Operator</span><strong>{currentAssignment.assignedBy}</strong></div><div><span>Attempt</span><strong>#{currentAssignment.attempt}</strong></div></div>
          </> : <div className="no-assignment"><span className="empty-icon"><Icon name="route" /></span><strong>Waiting for an eligible partner</strong><p>Assignment will be recorded with history and a local audit event.</p><Button variant="primary" onClick={() => open(`/admin/deliveries/${delivery.id}/assign`)} disabled={!canOperate || isTerminal}>Open assignment engine</Button></div>}
        </Panel>

        <Panel>
          <PanelHeading title="Assignment history" detail="Previous partner records are retained" />
          {history.length ? <div className="history-list">{history.map((assignment) => {
            const partner = data.partners.find((item) => item.id === assignment.partnerId)
            return <div className="history-row" key={assignment.id}><span className={`history-dot ${assignment.status === 'Active' ? 'history-dot-active' : ''}`} /><div><strong>{partner?.name ?? assignment.partnerId}<small>{partner?.id}</small></strong><span>{assignment.status} · assigned {formatDate(assignment.assignedAt)}</span>{assignment.releasedAt && <span>{assignment.status === 'Completed' ? 'Completed' : `Released ${formatDate(assignment.releasedAt)}`} · {assignment.releaseReason}</span>}<small>Operator: {assignment.assignedBy}</small></div></div>
          })}</div> : <p className="muted-copy">No assignment history yet.</p>}
        </Panel>

        <Panel className="record-meta-panel"><PanelHeading title="Record metadata" /><div className="record-meta-row"><span>Delivery ID</span><strong>{delivery.id}</strong></div><div className="record-meta-row"><span>Created</span><strong>{formatDate(delivery.createdAt)}</strong></div><div className="record-meta-row"><span>Record environment</span><strong>Local browser record</strong></div><div className="record-meta-row"><span>GPS / maps</span><strong>OpenStreetMap preview · live GPS not connected</strong></div></Panel>
      </div>
    </div>

    {dialog === 'cancel' && <ConfirmDialog title="Cancel this delivery?" detail="Cancellation is recorded with a required reason. Assignment and offer history are kept; partners are not silently removed." confirmLabel="Cancel delivery" danger onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'delivery.cancel', deliveryId: delivery.id, reason }); setDialog(null) }} />}
    {dialog === 'delay' && <ConfirmDialog title="Mark delivery delayed" detail="The current milestone will be preserved. A delay exception and operational notification are recorded." confirmLabel="Mark delayed" onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'delivery.delay', deliveryId: delivery.id, reason }); setDialog(null) }} />}
    {dialog === 'resolve' && <ConfirmDialog title="Resolve delivery delay" detail="Add an operational note to clear the delay flag. The delivery returns to its prior status and milestone." reasonLabel="Resolution note" confirmLabel="Resolve delay" onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'delivery.clear-delay', deliveryId: delivery.id, reason }); setDialog(null) }} />}
    {dialog && !['cancel', 'delay', 'resolve'].includes(dialog) && <ConfirmDialog title="Record partner rejection" detail="This simulated response is saved to offer history and the audit log." reasonLabel="Rejection reason" confirmLabel="Record rejection" onCancel={() => setDialog(null)} onConfirm={(reason) => { dispatch({ type: 'offer.reject', offerId: dialog, reason }); setDialog(null) }} />}
  </div>
}

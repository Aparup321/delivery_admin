import { useMemo } from 'react'
import type { Delivery, OperationsState } from '../domain/model'
import { getPartnerEligibility } from '../domain/operations'
import { Icon, Panel, PanelHeading, relativeTime } from '../components/ui'

interface Props {
  data: OperationsState
  open: (path: string) => void
}

const statusColors: Record<string, string> = {
  'In Transit': '#713CE0', Assigned: '#946ce8', Unassigned: '#9b98a4', Pending: '#e5a330', Delayed: '#d94f5c', Completed: '#29956f', Cancelled: '#777482',
}

function deliveryStatusCounts(deliveries: Delivery[]) {
  const order = ['In Transit', 'Assigned', 'Unassigned', 'Pending', 'Delayed', 'Completed', 'Cancelled']
  return order.map((status) => ({ status, count: deliveries.filter((delivery) => delivery.status === status).length }))
}

function auditPath(event: OperationsState['auditLogs'][number]) {
  if (event.targetType === 'Delivery') return `/admin/deliveries/${event.targetId}`
  if (event.targetType === 'Partner') return `/admin/partners/${event.targetId}`
  if (event.targetType === 'Settings') return '/admin/settings'
  return '/admin/audit-logs'
}

function activityByDay(data: OperationsState) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    const created = data.deliveries.filter((delivery) => {
      const time = new Date(delivery.createdAt).getTime()
      return time >= date.getTime() && time < next.getTime()
    }).length
    const completed = data.deliveries.filter((delivery) => delivery.status === 'Completed' && delivery.milestones[5]?.completedAt && new Date(delivery.milestones[5].completedAt).getTime() >= date.getTime() && new Date(delivery.milestones[5].completedAt).getTime() < next.getTime()).length
    return { label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date), created, completed }
  })
}

export function OverviewPage({ data, open }: Props) {
  const counts = useMemo(() => deliveryStatusCounts(data.deliveries), [data.deliveries])
  const bars = useMemo(() => activityByDay(data), [data.deliveries])
  const available = data.partners.filter((partner) => partner.availability === 'Available').length
  const active = data.partners.filter((partner) => partner.availability === 'Available' || partner.availability === 'On Delivery').length
  const pending = data.deliveries.filter((delivery) => delivery.status === 'Pending').length
  const unassigned = data.deliveries.filter((delivery) => delivery.status === 'Unassigned').length
  const assigned = data.deliveries.filter((delivery) => delivery.status === 'Assigned').length
  const inTransit = data.deliveries.filter((delivery) => delivery.status === 'In Transit').length
  const delayed = data.deliveries.filter((delivery) => delivery.status === 'Delayed').length
  const completed = data.deliveries.filter((delivery) => delivery.status === 'Completed').length
  const currentTime = Date.now()
  const activeOffers = data.offers.filter((offer) => offer.status === 'Awaiting Response')
  const expiringOffers = activeOffers.filter((offer) => new Date(offer.expiresAt).getTime() - currentTime < 10 * 60_000)
  const approaching = data.deliveries.filter((delivery) => !['Completed', 'Cancelled', 'Delayed'].includes(delivery.status) && new Date(delivery.scheduledEnd).getTime() > currentTime && new Date(delivery.scheduledEnd).getTime() - currentTime < 60 * 60_000)
  const incompletePartners = data.partners.filter((partner) => {
    const record = data.deliveries.find((delivery) => delivery.status === 'Unassigned') ?? data.deliveries[0]
    return record && !getPartnerEligibility(data, partner, record).eligible && data.documents.some((document) => document.partnerId === partner.id && document.status !== 'Verified')
  })
  const total = data.deliveries.length || 1
  const gradient = counts.reduce<{ text: string; cursor: number }>((result, item) => {
    const start = result.cursor
    const end = start + item.count / total * 100
    result.text += `${statusColors[item.status]} ${start}% ${end}%,`
    result.cursor = end
    return result
  }, { text: '', cursor: 0 }).text.slice(0, -1)
  const metrics = [
    { label: 'Total deliveries', value: data.deliveries.length, hint: 'All demo jobs', tone: 'purple', icon: 'deliveries' as const, path: '/admin/deliveries' },
    { label: 'Awaiting dispatch', value: pending + unassigned, hint: `${pending} pending · ${unassigned} unassigned`, tone: 'orange', icon: 'clock' as const, path: '/admin/deliveries' },
    { label: 'In progress', value: assigned + inTransit, hint: `${assigned} assigned · ${inTransit} in transit`, tone: 'lavender', icon: 'route' as const, path: '/admin/deliveries' },
    { label: 'Completed', value: completed, hint: 'Delivered', tone: 'green', icon: 'check-circle' as const, path: '/admin/deliveries?status=Completed' },
    { label: 'Delayed', value: delayed, hint: 'Needs attention', tone: 'red', icon: 'alert' as const, path: '/admin/deliveries?status=Delayed' },
    { label: 'Active partners', value: active, hint: `${available} available now`, tone: 'blue', icon: 'partners' as const, path: '/admin/partners' },
  ]

  return <div className="page-stack">
    <div className="metric-grid">{metrics.map((metric) => <button className="metric-card" key={metric.label} onClick={() => open(metric.path)}>
      <span className={`metric-icon tone-${metric.tone}`}><Icon name={metric.icon} size={17} /></span>
      <span className="metric-value">{metric.value}</span><span className="metric-label">{metric.label}</span><span className="metric-hint">{metric.hint}</span>
    </button>)}</div>

    <div className="overview-columns">
      <Panel className="status-overview">
        <PanelHeading title="Delivery status" detail={`${data.deliveries.length} demo records`} action={<button className="text-link" onClick={() => open('/admin/deliveries')}>View deliveries <Icon name="arrow" size={14} /></button>} />
        <div className="status-summary">
          <div className="status-donut" style={{ background: `conic-gradient(${gradient})` }}><div><strong>{data.deliveries.length}</strong><span>deliveries</span></div></div>
          <div className="status-legend">{counts.map((item) => <div key={item.status}><span><i style={{ backgroundColor: statusColors[item.status] }} />{item.status}</span><strong>{item.count}<small>{Math.round(item.count / total * 100)}%</small></strong></div>)}</div>
        </div>
      </Panel>

      <Panel className="activity-panel">
        <PanelHeading title="Delivery activity" detail="Created and completed · last 7 days" />
        <div className="activity-chart" role="img" aria-label="Daily demo deliveries created and completed over the last seven days">
          {bars.map((bar) => <div className="activity-day" key={bar.label}>
            <div className="activity-bars"><span className="activity-created" style={{ height: `${Math.max(bar.created ? 10 : 2, bar.created / Math.max(1, ...bars.map((item) => item.created)) * 66)}px` }} title={`${bar.created} created`} /><span className="activity-completed" style={{ height: `${Math.max(bar.completed ? 10 : 2, bar.completed / Math.max(1, ...bars.map((item) => item.completed)) * 66)}px` }} title={`${bar.completed} completed`} /></div>
            <small>{bar.label}</small>
          </div>)}
        </div>
        <div className="chart-legend-inline"><span><i className="legend-purple" />Created</span><span><i className="legend-green" />Completed</span><span className="demo-caption">Based on stored demo timestamps</span></div>
      </Panel>
    </div>

    <div className="overview-columns overview-lower">
      <Panel className="map-panel">
        <PanelHeading title="Active delivery areas" detail="Illustrative only · no live tracking" action={<span className="map-disclaimer">DEMO MAP</span>} />
        <div className="illustrative-map" aria-label="Illustrative service area diagram, not a live map">
          <svg viewBox="0 0 700 230" preserveAspectRatio="none" aria-hidden="true"><path className="map-river" d="M-20 156c95-55 115 32 209-14s123-78 205-22 149 71 326-11"/><path className="map-road" d="M12 32 156 73l112-41 164 53 104-38 173 52M-8 207l139-40 147 20 128-53 131 34 175-49M108-15l37 72-29 71 48 118M312-10l-29 62 30 72-24 115M546-12l-26 83 44 54-28 108"/><path className="map-route" d="M95 166c70-39 89-67 172-62s103 57 164 28 88 8 147-62"/></svg>
          <span className="map-point map-point-pickup"><i /><b>Pickup</b><small>Barasat · demo</small></span><span className="map-point map-point-mid"><i /><b>Area</b><small>New Town</small></span><span className="map-point map-point-drop"><i /><b>Drop</b><small>Rajarhat · demo</small></span>
          <span className="map-placeholder-label">Illustrative map — live tracking not connected.</span>
        </div>
      </Panel>

      <Panel className="attention-panel">
        <PanelHeading title="Operational attention" detail="Items that may need a review" />
        <div className="attention-list">
          {delayed > 0 && <button className="attention-row" onClick={() => open('/admin/deliveries?status=Delayed')}><span className="attention-icon attention-red"><Icon name="alert" size={15} /></span><span><b>{delayed} delayed delivery{delayed === 1 ? '' : 'ies'}</b><small>Review exceptions and preserved milestones</small></span><Icon name="chevron" size={15} /></button>}
          {unassigned > 0 && <button className="attention-row" onClick={() => open('/admin/deliveries?status=Unassigned')}><span className="attention-icon attention-orange"><Icon name="user" size={15} /></span><span><b>{unassigned} unassigned deliver{unassigned === 1 ? 'y' : 'ies'}</b><small>Find an eligible partner</small></span><Icon name="chevron" size={15} /></button>}
          {expiringOffers.length > 0 && <button className="attention-row" onClick={() => open(`/admin/deliveries/${expiringOffers[0].deliveryId}`)}><span className="attention-icon attention-orange"><Icon name="clock" size={15} /></span><span><b>{expiringOffers.length} offer{expiringOffers.length === 1 ? '' : 's'} expiring soon</b><small>Simulated offer response window</small></span><Icon name="chevron" size={15} /></button>}
          {approaching.length > 0 && <button className="attention-row" onClick={() => open(`/admin/deliveries/${approaching[0].id}`)}><span className="attention-icon attention-blue"><Icon name="calendar" size={15} /></span><span><b>{approaching.length} deadline{approaching.length === 1 ? '' : 's'} approaching</b><small>Scheduled end is within one hour</small></span><Icon name="chevron" size={15} /></button>}
          {incompletePartners.length > 0 && <button className="attention-row" onClick={() => open('/admin/partners?view=kyc')}><span className="attention-icon attention-purple"><Icon name="file" size={15} /></span><span><b>{incompletePartners.length} partner{incompletePartners.length === 1 ? '' : 's'} need verification</b><small>Open KYC review queue</small></span><Icon name="chevron" size={15} /></button>}
          {!delayed && !unassigned && !expiringOffers.length && !approaching.length && !incompletePartners.length && <p className="attention-clear"><Icon name="check-circle" size={16} />No attention items right now.</p>}
        </div>
      </Panel>
    </div>

    <Panel className="recent-activity-panel">
      <PanelHeading title="Recent operational activity" detail="Recorded from demo operations" action={<button className="text-link" onClick={() => open('/admin/audit-logs')}>Open audit log <Icon name="arrow" size={14} /></button>} />
      <div className="activity-feed">
        {data.auditLogs.slice(-5).reverse().map((event) => <button className="activity-feed-row" key={event.id} onClick={() => open(auditPath(event))}>
          <span className={`activity-event-icon ${event.eventType.includes('assigned') ? 'event-purple' : event.eventType.includes('Delayed') ? 'event-red' : 'event-gray'}`}><Icon name={event.eventType.includes('assigned') ? 'route' : event.eventType.includes('Delayed') ? 'alert' : 'check'} size={15} /></span>
          <span className="activity-event-copy"><b>{event.eventType}</b><small>{event.targetId} · {event.operator} · {event.reason}</small></span><time>{relativeTime(event.timestamp)}</time><Icon name="chevron" size={15} />
        </button>)}
        {!data.auditLogs.length && <p className="empty-inline">Operational changes will appear here after a demo action.</p>}
      </div>
    </Panel>
    <div className="overview-footnote"><Icon name="shield" size={14} /> Demo records only · Partner app data is read-only when manually connected; no live GPS, payments, or external delivery service is connected.</div>
  </div>
}

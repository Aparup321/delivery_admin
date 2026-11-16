import { useMemo } from 'react'
import type { Delivery, OperationsState } from '../domain/model'
import { buildKycQueue } from '../domain/kyc'
import { hasServiceAreaCoordinate, serviceAreaCoordinate } from '../domain/serviceAreas'
import { MapPreview, type MapPoint } from '../components/MapPreview'
import { Button, Icon, Panel, PanelHeading, relativeTime } from '../components/ui'
import { useLiveDeliveries } from '../hooks/useLiveDeliveries'
import { useOperations } from '../state/OperationsProvider'

interface Props {
  data: OperationsState
  open: (path: string) => void
}

/** Partner-side statuses that still represent a job on the road. */
const LIVE_ACTIVE_STATUSES = [
  'accepted',
  'pickup_arrived',
  'picked_up',
  'in_transit',
  'drop_arrived',
]

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
  const { frame } = useOperations()
  const live = useLiveDeliveries(frame.data.partnerApp)
  const liveDelivery = useMemo(
    () => live.deliveries.find((delivery) => LIVE_ACTIVE_STATUSES.includes(delivery.nativeStatus)) ?? null,
    [live.deliveries],
  )
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
  const pendingKyc = buildKycQueue(data).filter((item) => item.status === 'Submitted').length
  const mapRoute = useMemo(() => {
    if (liveDelivery) {
      const points: MapPoint[] = [
        {
          id: `${liveDelivery.id}-pickup`,
          label: `Pickup · ${liveDelivery.pickup.name}`,
          latitude: liveDelivery.pickup.latitude,
          longitude: liveDelivery.pickup.longitude,
          kind: 'pickup',
        },
        {
          id: `${liveDelivery.id}-drop`,
          label: `Drop · ${liveDelivery.destination.name}`,
          latitude: liveDelivery.destination.latitude,
          longitude: liveDelivery.destination.longitude,
          kind: 'drop',
        },
      ]
      if (liveDelivery.currentLocation) {
        points.push({
          id: `${liveDelivery.id}-partner`,
          label: liveDelivery.partnerName,
          latitude: liveDelivery.currentLocation.latitude,
          longitude: liveDelivery.currentLocation.longitude,
          kind: 'partner',
        })
      }
      return {
        source: 'live' as const,
        id: liveDelivery.displayId,
        summary: `${liveDelivery.pickup.name} → ${liveDelivery.destination.name}`,
        approximate: false,
        points,
        detailPath: null,
        locationUpdatedAt: liveDelivery.currentLocation?.updatedAt ?? null,
        updatedAt: liveDelivery.updatedAt,
      }
    }

    const delivery = data.deliveries.find((item) => item.status === 'In Transit')
      ?? data.deliveries.find((item) => item.status === 'Delayed')
      ?? data.deliveries.find((item) => item.status === 'Assigned')
      ?? data.deliveries[0]
    if (!delivery) return null
    return {
      source: 'demo' as const,
      id: delivery.id,
      summary: `${delivery.pickup} → ${delivery.drop}`,
      approximate: !hasServiceAreaCoordinate(delivery.pickup) || !hasServiceAreaCoordinate(delivery.drop),
      points: [
        { id: `${delivery.id}-pickup`, label: `Pickup · ${delivery.pickup}`, ...serviceAreaCoordinate(delivery.pickup), kind: 'pickup' as const },
        { id: `${delivery.id}-drop`, label: `Drop · ${delivery.drop}`, ...serviceAreaCoordinate(delivery.drop), kind: 'drop' as const },
      ],
      detailPath: `/admin/deliveries/${delivery.id}`,
      locationUpdatedAt: null,
      updatedAt: delivery.createdAt,
    }
  }, [liveDelivery, data.deliveries])
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
        <PanelHeading
          title="Active delivery map"
          detail={mapRoute ? `${mapRoute.id} · ${mapRoute.summary}${mapRoute.source === 'live' && liveDelivery ? ` · ${liveDelivery.status}` : ''}` : 'No delivery record'}
          action={<span className="map-heading-actions">
            {mapRoute && <span className={`source-tag source-${mapRoute.source}`}><i />{mapRoute.source === 'live' ? 'Live' : 'Demo'}</span>}
            {mapRoute?.detailPath && <button className="text-link" onClick={() => open(mapRoute.detailPath!)}>Open delivery <Icon name="arrow" size={14} /></button>}
          </span>}
        />
        {live.error && <div className="soft-notice map-sync-notice"><Icon name="alert" size={15} /><span>Live delivery sync failed. {mapRoute?.source === 'live' ? 'The map may be stale.' : 'Showing the demo route instead.'}</span><Button size="small" variant="quiet" title={live.error} onClick={live.refresh}>Retry</Button></div>}
        <MapPreview
          points={mapRoute?.points ?? []}
          ariaLabel={mapRoute ? `OpenStreetMap preview of ${mapRoute.summary}` : 'OpenStreetMap delivery area preview'}
        />
        <p className="osm-map-footnote"><Icon name="info" size={13} />{mapRoute?.source === 'live'
          ? <>Live delivery from delivery_app · {mapRoute.locationUpdatedAt ? `Partner position updated ${relativeTime(mapRoute.locationUpdatedAt)}. ` : "Waiting for the partner's GPS position. "}Routing and ETAs are approximate.</>
          : <>Demo route · no active live delivery. OpenStreetMap tiles, shared with delivery_app. {mapRoute?.approximate ? 'Some area coordinates are approximate. ' : ''}Live GPS, routing and ETAs for demo jobs are not connected.</>}</p>
      </Panel>

      <Panel className="attention-panel">
        <PanelHeading title="Operational attention" detail="Items that may need a review" />
        <div className="attention-list">
          {delayed > 0 && <button className="attention-row" onClick={() => open('/admin/deliveries?status=Delayed')}><span className="attention-icon attention-red"><Icon name="alert" size={15} /></span><span><b>{delayed} delayed delivery{delayed === 1 ? '' : 'ies'}</b><small>Review exceptions and preserved milestones</small></span><Icon name="chevron" size={15} /></button>}
          {unassigned > 0 && <button className="attention-row" onClick={() => open('/admin/deliveries?status=Unassigned')}><span className="attention-icon attention-orange"><Icon name="user" size={15} /></span><span><b>{unassigned} unassigned deliver{unassigned === 1 ? 'y' : 'ies'}</b><small>Find an eligible partner</small></span><Icon name="chevron" size={15} /></button>}
          {expiringOffers.length > 0 && <button className="attention-row" onClick={() => open(`/admin/deliveries/${expiringOffers[0].deliveryId}`)}><span className="attention-icon attention-orange"><Icon name="clock" size={15} /></span><span><b>{expiringOffers.length} offer{expiringOffers.length === 1 ? '' : 's'} expiring soon</b><small>Simulated offer response window</small></span><Icon name="chevron" size={15} /></button>}
          {approaching.length > 0 && <button className="attention-row" onClick={() => open(`/admin/deliveries/${approaching[0].id}`)}><span className="attention-icon attention-blue"><Icon name="calendar" size={15} /></span><span><b>{approaching.length} deadline{approaching.length === 1 ? '' : 's'} approaching</b><small>Scheduled end is within one hour</small></span><Icon name="chevron" size={15} /></button>}
          {pendingKyc > 0 && <button className="attention-row" onClick={() => open('/admin/kyc')}><span className="attention-icon attention-purple"><Icon name="file" size={15} /></span><span><b>{pendingKyc} KYC application{pendingKyc === 1 ? '' : 's'} need review</b><small>Approve or reject onboarding applications</small></span><Icon name="chevron" size={15} /></button>}
          {!delayed && !unassigned && !expiringOffers.length && !approaching.length && !pendingKyc && <p className="attention-clear"><Icon name="check-circle" size={16} />No attention items right now.</p>}
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
    <div className="overview-footnote"><Icon name="shield" size={14} /> Administrator decisions are mirrored to delivery_app. The map uses OpenStreetMap tiles shared with the partner app; demo jobs remain simulated.</div>
  </div>
}

import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { userCan, userHasSection } from '../domain/admin'
import type { Delivery, OperationsState } from '../domain/model'
import { buildKycQueue } from '../domain/kyc'
import { hasServiceAreaCoordinate, serviceAreaCoordinate } from '../domain/serviceAreas'
import { MapPreview, type MapPoint } from '../components/MapPreview'
import { Button, Icon, Panel, PanelHeading, relativeTime } from '../components/ui'
import { useLiveDeliveries } from '../hooks/useLiveDeliveries'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
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

/** Recharts animates in SVG, so the CSS reduced-motion rule alone is not enough. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export function OverviewPage({ data, open }: Props) {
  const { frame } = useOperations()
  const reducedMotion = useReducedMotion()
  const [activeStatus, setActiveStatus] = useState<string | null>(null)
  const [visibleSeries, setVisibleSeries] = useState({ created: true, completed: true })
  const live = useLiveDeliveries(frame.data.partnerApp, hasFirebaseAdminSession())
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
  const pendingKyc = buildKycQueue(data).filter((item) => item.status === 'Submitted' || item.status === 'KYC pending').length
  const canViewDeliveries = userHasSection(frame.data.user, 'deliveries')
  const canReviewOnboarding = userCan(frame.data.user, 'application-review')
  const canViewAudit = userHasSection(frame.data.user, 'audit-logs')
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
  const pieData = counts
    .filter((item) => item.count > 0)
    .map((item) => ({ ...item, value: item.count, percent: Math.round(item.count / total * 100), color: statusColors[item.status] }))
  const activeEntry = activeStatus ? counts.find((item) => item.status === activeStatus) ?? null : null
  const scheduledCreated = bars.reduce((sum, item) => sum + item.created, 0)
  const scheduledCompleted = bars.reduce((sum, item) => sum + item.completed, 0)
  const metrics = [
    { label: 'Total deliveries', value: data.deliveries.length, hint: 'All delivery jobs', tone: 'purple', icon: 'deliveries' as const, path: '/admin/deliveries' },
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
        <PanelHeading title="Delivery status" detail={`${data.deliveries.length} delivery records`} action={<button className="text-link" onClick={() => open('/admin/deliveries')}>View deliveries <Icon name="arrow" size={14} /></button>} />
        <div className="status-summary">
          <div className="status-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer>
                <Tooltip
                  cursor={false}
                  contentStyle={{ borderRadius: 10, border: '1px solid #e8e3f0', boxShadow: '0 12px 30px rgba(25,21,43,.12)', fontSize: 11, padding: '8px 10px' }}
                  itemStyle={{ color: '#433d4b', fontSize: 10, fontWeight: 600 }}
                  labelStyle={{ display: 'none' }}
                  formatter={(value, name, item) => {
                    const percent = (item?.payload as { percent?: number } | undefined)?.percent
                    return [`${value} deliveries${percent != null ? ` · ${percent}%` : ''}`, String(name ?? '')]
                  }}
                />
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="status"
                  innerRadius="58%"
                  outerRadius="86%"
                  paddingAngle={2}
                  cornerRadius={6}
                  stroke="#fff"
                  strokeWidth={2}
                  isAnimationActive={!reducedMotion}
                  animationDuration={750}
                  animationEasing="ease-out"
                  onMouseEnter={(_, index) => setActiveStatus(pieData[index]?.status ?? null)}
                  onMouseLeave={() => setActiveStatus(null)}
                  onClick={(entry) => {
                    const status = (entry as { status?: string } | undefined)?.status
                    if (status) open(`/admin/deliveries?status=${encodeURIComponent(status)}`)
                  }}
                >
                  {pieData.map((item) => <Cell key={item.status} fill={item.color} opacity={activeStatus && activeStatus !== item.status ? .3 : 1} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="status-donut-center"><strong>{activeEntry?.count ?? data.deliveries.length}</strong><span>{activeEntry?.status ?? 'deliveries'}</span></div>
          </div>
          <div className="status-legend">{counts.map((item) => <button
            type="button"
            key={item.status}
            className={activeStatus === item.status ? 'active' : ''}
            onMouseEnter={() => setActiveStatus(item.status)}
            onMouseLeave={() => setActiveStatus(null)}
            onFocus={() => setActiveStatus(item.status)}
            onBlur={() => setActiveStatus(null)}
            onClick={() => open(`/admin/deliveries?status=${encodeURIComponent(item.status)}`)}
          ><span><i style={{ backgroundColor: statusColors[item.status] }} />{item.status}</span><strong>{item.count}<small>{Math.round(item.count / total * 100)}%</small></strong></button>)}</div>
        </div>
      </Panel>

      <Panel className="activity-panel">
        <PanelHeading title="Delivery activity" detail="Created and completed · last 7 days" action={<button className="text-link" onClick={() => open('/admin/deliveries')}>View deliveries <Icon name="arrow" size={14} /></button>} />
        <div className="activity-chart-recharts">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 8, right: 10, left: 0, bottom: 0 }} barGap={3} barCategoryGap="26%" accessibilityLayer>
              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#efedf3" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#5f5a68', fontSize: 9 }} dy={5} />
              <YAxis allowDecimals={false} width={24} axisLine={false} tickLine={false} tick={{ fill: '#8a8592', fontSize: 8 }} />
              <Tooltip
                cursor={{ fill: 'rgba(113,60,224,.045)' }}
                contentStyle={{ borderRadius: 10, border: '1px solid #e8e3f0', boxShadow: '0 12px 30px rgba(25,21,43,.12)', fontSize: 11, padding: '8px 10px' }}
                itemStyle={{ fontSize: 10, fontWeight: 600 }}
                labelStyle={{ color: '#6b6573', fontSize: 9, marginBottom: 4 }}
                formatter={(value, name) => [`${value} deliver${value === 1 ? 'y' : 'ies'}`, name === 'created' ? 'Created' : 'Completed']}
              />
              {visibleSeries.created && <Bar dataKey="created" name="created" fill="#8d6bce" radius={[5, 5, 0, 0]} maxBarSize={16} isAnimationActive={!reducedMotion} animationDuration={650} animationEasing="ease-out" activeBar={{ fill: '#6f3fd8', opacity: .86 }} />}
              {visibleSeries.completed && <Bar dataKey="completed" name="completed" fill="#62a982" radius={[5, 5, 0, 0]} maxBarSize={16} isAnimationActive={!reducedMotion} animationDuration={650} animationEasing="ease-out" activeBar={{ fill: '#4f9e75', opacity: .86 }} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-legend-inline">
          <button type="button" className={`chart-series-toggle ${visibleSeries.created ? 'active' : ''}`} aria-pressed={visibleSeries.created} onClick={() => setVisibleSeries((current) => ({ ...current, created: !current.created }))}><i className="legend-purple" />Created <b>{scheduledCreated}</b></button>
          <button type="button" className={`chart-series-toggle ${visibleSeries.completed ? 'active' : ''}`} aria-pressed={visibleSeries.completed} onClick={() => setVisibleSeries((current) => ({ ...current, completed: !current.completed }))}><i className="legend-green" />Completed <b>{scheduledCompleted}</b></button>
          <span className="demo-caption">Last 7 days · click a series to toggle</span>
        </div>
      </Panel>
    </div>

    <div className="overview-columns overview-lower">
      <Panel className="map-panel">
        <PanelHeading
          title="Active delivery map"
          detail={mapRoute ? `${mapRoute.id} · ${mapRoute.summary}${mapRoute.source === 'live' && liveDelivery ? ` · ${liveDelivery.status}` : ''}` : 'No delivery record'}
          action={<span className="map-heading-actions">
            {mapRoute && <span className={`source-tag source-${mapRoute.source}`}><i />{mapRoute.source === 'live' ? 'Live' : 'Local'}</span>}
            {mapRoute?.detailPath && <button className="text-link" onClick={() => open(mapRoute.detailPath!)}>Open delivery <Icon name="arrow" size={14} /></button>}
          </span>}
        />
        {live.error && <div className="soft-notice map-sync-notice"><Icon name="alert" size={15} /><span>{live.error} {mapRoute?.source === 'live' ? 'The map may be stale.' : 'Showing the local route instead.'}</span><Button size="small" variant="quiet" onClick={live.refresh}>Retry</Button></div>}
        <MapPreview
          points={mapRoute?.points ?? []}
          ariaLabel={mapRoute ? `OpenStreetMap preview of ${mapRoute.summary}` : 'OpenStreetMap delivery area preview'}
          recenterKey={mapRoute?.id ?? 'none'}
          followPointId={liveDelivery?.currentLocation ? `${liveDelivery.id}-partner` : undefined}
        />
        <p className="osm-map-footnote"><Icon name="info" size={13} />{mapRoute?.source === 'live'
          ? <>Live delivery from delivery_app · {mapRoute.locationUpdatedAt ? `Partner position updated ${relativeTime(mapRoute.locationUpdatedAt)}. ` : "Waiting for the partner's GPS position. "}Routing and ETAs are approximate.</>
          : <>Local route · no active live delivery. OpenStreetMap tiles, shared with delivery_app. {mapRoute?.approximate ? 'Some area coordinates are approximate. ' : ''}Live GPS, routing and ETAs for local jobs are not connected.</>}</p>
      </Panel>

      <Panel className="attention-panel">
        <PanelHeading title="Operational attention" detail="Items that may need a review" />
        <div className="attention-list">
          {canViewDeliveries && delayed > 0 && <button className="attention-row" onClick={() => open('/admin/deliveries?status=Delayed')}><span className="attention-icon attention-red"><Icon name="alert" size={15} /></span><span><b>{delayed} delayed delivery{delayed === 1 ? '' : 'ies'}</b><small>Review exceptions and preserved milestones</small></span><Icon name="chevron" size={15} /></button>}
          {canViewDeliveries && unassigned > 0 && <button className="attention-row" onClick={() => open('/admin/deliveries?status=Unassigned')}><span className="attention-icon attention-orange"><Icon name="user" size={15} /></span><span><b>{unassigned} unassigned deliver{unassigned === 1 ? 'y' : 'ies'}</b><small>Find an eligible partner</small></span><Icon name="chevron" size={15} /></button>}
          {canViewDeliveries && expiringOffers.length > 0 && <button className="attention-row" onClick={() => open(`/admin/deliveries/${expiringOffers[0].deliveryId}`)}><span className="attention-icon attention-orange"><Icon name="clock" size={15} /></span><span><b>{expiringOffers.length} offer{expiringOffers.length === 1 ? '' : 's'} expiring soon</b><small>Simulated offer response window</small></span><Icon name="chevron" size={15} /></button>}
          {canViewDeliveries && approaching.length > 0 && <button className="attention-row" onClick={() => open(`/admin/deliveries/${approaching[0].id}`)}><span className="attention-icon attention-blue"><Icon name="calendar" size={15} /></span><span><b>{approaching.length} deadline{approaching.length === 1 ? '' : 's'} approaching</b><small>Scheduled end is within one hour</small></span><Icon name="chevron" size={15} /></button>}
          {canReviewOnboarding && pendingKyc > 0 && <button className="attention-row" onClick={() => open('/admin/kyc')}><span className="attention-icon attention-purple"><Icon name="file" size={15} /></span><span><b>{pendingKyc} partner{pendingKyc === 1 ? '' : 's'} awaiting KYC</b><small>New sign-ins and submitted applications</small></span><Icon name="chevron" size={15} /></button>}
          {!(canViewDeliveries && (delayed || unassigned || expiringOffers.length || approaching.length)) && !(canReviewOnboarding && pendingKyc) && <p className="attention-clear"><Icon name="check-circle" size={16} />No attention items right now.</p>}
        </div>
      </Panel>
    </div>

    <Panel className="recent-activity-panel">
      <PanelHeading title="Recent operational activity" detail="Recorded from operations" action={canViewAudit ? <button className="text-link" onClick={() => open('/admin/audit-logs')}>Open audit log <Icon name="arrow" size={14} /></button> : undefined} />
      <div className="activity-feed">
        {data.auditLogs.slice(-5).reverse().map((event) => <button className="activity-feed-row" key={event.id} onClick={() => open(auditPath(event))}>
          <span className={`activity-event-icon ${event.eventType.includes('assigned') ? 'event-purple' : event.eventType.includes('Delayed') ? 'event-red' : 'event-gray'}`}><Icon name={event.eventType.includes('assigned') ? 'route' : event.eventType.includes('Delayed') ? 'alert' : 'check'} size={15} /></span>
          <span className="activity-event-copy"><b>{event.eventType}</b><small>{event.targetId} · {event.operator} · {event.reason}</small></span><time>{relativeTime(event.timestamp)}</time><Icon name="chevron" size={15} />
        </button>)}
        {!data.auditLogs.length && <p className="empty-inline">Operational changes will appear here after an action.</p>}
      </div>
    </Panel>
    <div className="overview-footnote"><Icon name="shield" size={14} /> Administrator decisions are mirrored to delivery_app. The map uses OpenStreetMap tiles shared with the partner app; local admin records are not published until a partner is assigned.</div>
  </div>
}

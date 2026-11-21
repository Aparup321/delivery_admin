import { useMemo, useState } from 'react'
import { hasFirebaseAdminSession } from '../services/firebaseAuth'
import { useLiveDeliveries } from '../hooks/useLiveDeliveries'
import type { OperationsState } from '../domain/model'
import { MapPreview, type MapPoint } from '../components/MapPreview'
import { Button, EmptyState, formatDate, Icon, Panel, PanelHeading, StatusBadge } from '../components/ui'

const ACTIVE_STATUSES = new Set(['accepted', 'pickup_arrived', 'picked_up', 'in_transit', 'drop_arrived'])
const STALE_AFTER_MS = 2 * 60_000
const TRACKING_POLL_MS = 15_000
const TRACKING_CACHE_MS = 5_000

function relativeLocationTime(value: string | null) {
  if (!value) return 'No location received'
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Updated just now'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Updated just now'
  return `Updated ${minutes} min ago`
}

export function TrackingPage({ data, open }: { data: OperationsState; open: (path: string) => void }) {
  const live = useLiveDeliveries(data.partnerApp, hasFirebaseAdminSession(), {
    pollIntervalMs: TRACKING_POLL_MS,
    cacheMaxAgeMs: TRACKING_CACHE_MS,
  })
  const activeDeliveries = useMemo(() => live.deliveries.filter((delivery) => ACTIVE_STATUSES.has(delivery.nativeStatus)), [live.deliveries])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = activeDeliveries.find((delivery) => delivery.id === selectedId) ?? activeDeliveries[0]
  const points: MapPoint[] = selected ? [
    { id: `${selected.id}-pickup`, label: `Pickup · ${selected.pickup.name}`, latitude: selected.pickup.latitude, longitude: selected.pickup.longitude, kind: 'pickup' },
    { id: `${selected.id}-drop`, label: `Drop · ${selected.destination.name}`, latitude: selected.destination.latitude, longitude: selected.destination.longitude, kind: 'drop' },
    ...(selected.currentLocation ? [{ id: `${selected.id}-partner`, label: selected.partnerName, latitude: selected.currentLocation.latitude, longitude: selected.currentLocation.longitude, kind: 'partner' as const }] : []),
  ] : []
  const locationAge = selected?.currentLocation?.updatedAt ? Date.now() - new Date(selected.currentLocation.updatedAt).getTime() : Infinity
  const locationStale = locationAge > STALE_AFTER_MS

  return <div className="page-stack tracking-page">
    <div className="tracking-toolbar"><div><strong>{activeDeliveries.length}</strong><span>active delivery{activeDeliveries.length === 1 ? '' : 'ies'} from delivery_app</span></div><Button size="small" variant="quiet" onClick={live.refresh} disabled={live.loading}><Icon name="refresh" size={14} />{live.loading ? 'Refreshing…' : 'Refresh'}</Button></div>
    {!hasFirebaseAdminSession() && <div className="soft-notice"><Icon name="info" size={15} /><span>Sign in with a Firebase administrator account to monitor live partner deliveries. Demo/local deliveries are not shown as live.</span><Button size="small" variant="quiet" onClick={() => open('/admin/settings?tab=partner-app')}>Open connection settings</Button></div>}
    {live.error && <div className="soft-notice error-notice"><Icon name="alert" size={15} /><span>{live.error}</span><Button size="small" variant="quiet" onClick={live.refresh}>Retry</Button></div>}
    {activeDeliveries.length === 0 && !live.loading ? <Panel><EmptyState title="No active live deliveries" detail="Accepted and in-progress deliveries published by delivery_app will appear here. Local admin-only records are excluded until the order is published to the partner app." /></Panel> : <div className="tracking-layout">
      <Panel className="tracking-list-panel"><PanelHeading title="Active deliveries" detail="Select a delivery to inspect its latest location" />{activeDeliveries.map((delivery) => {
        const updatedAt = delivery.currentLocation?.updatedAt ?? delivery.updatedAt
        const stale = !delivery.currentLocation || Date.now() - new Date(updatedAt ?? 0).getTime() > STALE_AFTER_MS
        return <button key={delivery.id} className={`tracking-list-row ${selected?.id === delivery.id ? 'selected' : ''}`} onClick={() => setSelectedId(delivery.id)}><span className="tracking-list-icon"><Icon name="route" size={16} /></span><span><strong>{delivery.displayId}</strong><small>{delivery.partnerName} · {delivery.pickup.name} → {delivery.destination.name}</small><small className={stale ? 'tracking-stale' : 'tracking-fresh'}>{stale ? 'Location unavailable or stale' : relativeLocationTime(delivery.currentLocation?.updatedAt ?? null)}</small></span><StatusBadge status={delivery.status} /></button>
      })}</Panel>
      {selected && <div className="tracking-detail-column"><Panel className="tracking-map-panel"><PanelHeading title={selected.displayId} detail={`${selected.pickup.name} → ${selected.destination.name}`} action={<StatusBadge status={selected.status} />} /><MapPreview points={points} ariaLabel={`Live map for ${selected.displayId}`} /><div className={`tracking-location-banner ${locationStale ? 'stale' : 'fresh'}`}><Icon name={locationStale ? 'alert' : 'pin'} size={15} /><span><strong>{locationStale ? 'Location sharing unavailable or stale' : 'Partner location available'}</strong><small>{selected.currentLocation ? `${relativeLocationTime(selected.currentLocation.updatedAt)} · ${selected.currentLocation.accuracy ? `±${Math.round(selected.currentLocation.accuracy)}m` : 'accuracy unavailable'}` : 'Showing pickup and drop only; no partner position has been published.'}</small></span></div><p className="osm-map-footnote"><Icon name="info" size={13} />OpenStreetMap tiles with attribution. This view displays the partner app’s last published position; it does not infer movement.</p></Panel><Panel><PanelHeading title="Delivery and partner details" /><div className="tracking-facts"><div><span>Partner</span><strong>{selected.partnerName}</strong></div><div><span>Vehicle</span><strong>{selected.vehicleType}</strong></div><div><span>Delivery status</span><strong>{selected.status}</strong></div><div><span>Last record update</span><strong>{selected.updatedAt ? formatDate(selected.updatedAt) : '—'}</strong></div><div><span>Pickup</span><strong>{selected.pickup.address || selected.pickup.name}</strong></div><div><span>Drop</span><strong>{selected.destination.address || selected.destination.name}</strong></div><div><span>Customer</span><strong>{selected.customerName || 'Not provided'}</strong></div><div><span>Contact</span><strong>{selected.customerPhoneMasked || 'Protected'}</strong></div>{selected.proof ? <><div><span>Received by</span><strong>{selected.proof.recipientName || 'Not provided'}</strong></div><div><span>Handover note</span><strong>{selected.proof.note || '—'}</strong></div><div><span>Proof verified</span><strong>{formatDate(selected.proof.verifiedAt)}</strong></div></> : null}</div><div className="dialog-actions"><Button variant="secondary" onClick={() => open(`/admin/deliveries/${selected.id}`)}>Open delivery record</Button></div></Panel><Panel><PanelHeading title="Lifecycle history" detail="Partner-published events" />{selected.events.length ? <div className="tracking-events">{selected.events.map((event) => <div key={`${event.status}-${event.at}`}><Icon name="check-circle" size={14} /><span><strong>{event.status.replace(/_/g, ' ')}</strong><small>{formatDate(event.at)}</small></span></div>)}</div> : <p className="muted-copy">No lifecycle events were published.</p>}</Panel></div>}
    </div>}
  </div>
}

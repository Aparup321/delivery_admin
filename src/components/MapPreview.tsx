import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import { Icon } from './ui'

export interface MapPoint {
  id: string
  label: string
  latitude: number
  longitude: number
  kind?: 'pickup' | 'drop' | 'partner' | 'neutral'
}

interface MapPreviewProps {
  points: MapPoint[]
  ariaLabel: string
  className?: string
  onMapClick?: (location: { latitude: number; longitude: number }) => void
  /**
   * Keep this marker in view while it moves. Used by live tracking so the
   * partner stays visible as new GPS fixes arrive.
   */
  followPointId?: string
  /** Change this value to re-fit the map to the current points. */
  recenterKey?: string | number
}

const DEFAULT_CENTER: L.LatLngTuple = [22.5726, 88.3639]

/** Only Web Mercator-safe coordinates can be rendered by Leaflet. */
function pointLatLng(point: MapPoint): L.LatLng | null {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null
  if (point.latitude < -85.0511 || point.latitude > 85.0511) return null
  if (point.longitude < -180 || point.longitude > 180) return null
  if (point.latitude === 0 && point.longitude === 0) return null
  return L.latLng(point.latitude, point.longitude)
}

function markerKind(kind: MapPoint['kind']) {
  return kind === 'pickup' || kind === 'drop' || kind === 'partner'
    ? kind
    : 'neutral'
}

function markerColor(kind: MapPoint['kind']) {
  if (kind === 'pickup') return '#29956f'
  if (kind === 'drop') return '#d94f5c'
  if (kind === 'partner') return '#2f7de1'
  return '#713ce0'
}

/**
 * Leaflet treats string tooltip content as HTML. Labels include partner names
 * and free-text addresses, so pass a text node instead of interpolating data.
 */
function tooltipText(label: string) {
  const node = document.createElement('span')
  node.textContent = label
  return node
}

function fitMap(map: L.Map, points: MapPoint[], animate = false) {
  const coordinates = points
    .map(pointLatLng)
    .filter((point): point is L.LatLng => Boolean(point))

  if (!coordinates.length) {
    map.setView(DEFAULT_CENTER, 12, { animate })
    return
  }

  if (coordinates.length === 1) {
    map.setView(coordinates[0], Math.max(map.getZoom(), 14), { animate })
    return
  }

  map.fitBounds(L.latLngBounds(coordinates), {
    padding: [28, 28],
    maxZoom: 15,
    animate,
  })
}

/**
 * Interactive OpenStreetMap view built on Leaflet. Drag to pan, scroll or use
 * the controls to zoom, and click to place a stop when `onMapClick` is set.
 * The static tile renderer this replaces could not be panned or zoomed.
 */
export function MapPreview({
  points,
  ariaLabel,
  className = '',
  onMapClick,
  followPointId,
  recenterKey,
}: MapPreviewProps) {
  const mapNodeRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const onMapClickRef = useRef(onMapClick)
  const pointsRef = useRef(points)
  const hasFittedRef = useRef(false)
  const lastRecenterKeyRef = useRef<string | number | undefined>(recenterKey)
  const [ready, setReady] = useState(false)
  const [mapVersion, setMapVersion] = useState(0)
  const [follow, setFollow] = useState(Boolean(followPointId))
  const interactive = Boolean(onMapClick)

  useEffect(() => {
    onMapClickRef.current = onMapClick
  }, [onMapClick])

  useEffect(() => {
    pointsRef.current = points
  }, [points])

  useEffect(() => {
    setFollow(Boolean(followPointId))
  }, [followPointId])

  // Create the Leaflet map once. StrictMode mounts the effect twice in
  // development, so cleanup must fully remove the map before re-initialising.
  useEffect(() => {
    const node = mapNodeRef.current
    if (!node) return

    const map = L.map(node, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      doubleClickZoom: !onMapClickRef.current,
      boxZoom: true,
      keyboard: true,
      zoomSnap: 1,
      minZoom: 3,
      maxZoom: 19,
    })
    mapRef.current = map
    map.setView(DEFAULT_CENTER, 12, { animate: false })

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    })
    tiles.addTo(map)

    const markers = L.layerGroup().addTo(map)
    markerLayerRef.current = markers

    const stopFollowing = (event: L.LeafletEvent) => {
      // Only a real user gesture should stop follow mode; programmatic pans
      // and zooms from the map controls have no originalEvent.
      if ((event as L.LeafletEvent & { originalEvent?: unknown }).originalEvent) {
        setFollow(false)
      }
    }
    map.on('dragstart', stopFollowing)
    map.on('zoomstart', stopFollowing)
    map.on('click', (event: L.LeafletMouseEvent) => {
      onMapClickRef.current?.({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      })
    })

    hasFittedRef.current = false
    lastRecenterKeyRef.current = recenterKey
    setReady(true)
    setMapVersion((value) => value + 1)

    const invalidate = () => map.invalidateSize({ pan: false })
    const frame = window.requestAnimationFrame(invalidate)
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(invalidate)
      observer.observe(node)
    } else {
      window.addEventListener('resize', invalidate)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', invalidate)
      map.remove()
      mapRef.current = null
      markerLayerRef.current = null
    }
    // The map is created once; click behaviour is read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Draw markers whenever the stops or their coordinates change. The string
  // key prevents a full redraw when a parent re-renders with an equal array.
  const pointsKey = points
    .map((point) => `${point.id}:${point.latitude}:${point.longitude}:${point.label}:${point.kind ?? 'neutral'}`)
    .join('|')

  useEffect(() => {
    const map = mapRef.current
    const layer = markerLayerRef.current
    if (!map || !layer || !ready) return

    layer.clearLayers()
    const valid = pointsRef.current
      .map((point) => ({ point, latlng: pointLatLng(point) }))
      .filter((entry): entry is { point: MapPoint; latlng: L.LatLng } => Boolean(entry.latlng))

    for (const { point, latlng } of valid) {
      const color = markerColor(point.kind)
      const kind = markerKind(point.kind)
      const tooltipClass = `osm-map-tooltip osm-map-tooltip-${kind}`

      if (interactive && valid.length === 1) {
        // The create-delivery picker has one movable stop. A draggable marker
        // makes fine adjustment possible without hunting for another click.
        const icon = L.divIcon({
          className: 'osm-picker-marker',
          html: `<span class="osm-picker-dot osm-picker-dot-${kind}"></span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        })
        const marker = L.marker(latlng, {
          icon,
          draggable: true,
          autoPan: true,
          keyboard: false,
        })
        marker.on('dragend', () => {
          const next = marker.getLatLng()
          onMapClickRef.current?.({ latitude: next.lat, longitude: next.lng })
        })
        marker.bindTooltip(tooltipText(point.label), {
          permanent: true,
          direction: 'right',
          offset: [11, 0],
          className: tooltipClass,
          opacity: 1,
        })
        marker.addTo(layer)
        continue
      }

      if (point.kind === 'partner') {
        L.circleMarker(latlng, {
          radius: 16,
          stroke: false,
          fillColor: color,
          fillOpacity: 0.16,
          interactive: false,
        }).addTo(layer)
      }

      const dot = L.circleMarker(latlng, {
        radius: 7,
        weight: 3,
        color: '#fff',
        fillColor: color,
        fillOpacity: 1,
        interactive: false,
      })
      dot.bindTooltip(tooltipText(point.label), {
        permanent: true,
        direction: 'right',
        offset: [10, 0],
        className: tooltipClass,
        opacity: 1,
      })
      dot.addTo(layer)
    }
  }, [pointsKey, ready, mapVersion, interactive])

  // Fit once when the first usable points arrive. Later coordinate updates
  // (live GPS, a placed pin) must not yank the viewport away from the operator.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (hasFittedRef.current) return
    if (!pointsRef.current.some(pointLatLng)) return
    fitMap(map, pointsRef.current, false)
    hasFittedRef.current = true
  }, [pointsKey, ready, mapVersion])

  useEffect(() => {
    if (recenterKey === undefined) return
    if (lastRecenterKeyRef.current === recenterKey) return
    lastRecenterKeyRef.current = recenterKey
    const map = mapRef.current
    if (!map) return
    fitMap(map, pointsRef.current, true)
  }, [recenterKey, ready, mapVersion])

  // Keep the live partner marker inside the viewport while follow mode is on.
  useEffect(() => {
    if (!follow || !followPointId) return
    const map = mapRef.current
    if (!map) return
    const point = pointsRef.current.find((item) => item.id === followPointId)
    const latlng = point ? pointLatLng(point) : null
    if (!latlng) return
    if (!map.getBounds().pad(-0.12).contains(latlng)) {
      map.panTo(latlng, { animate: true, duration: 0.4 })
    }
  }, [pointsKey, follow, followPointId, ready, mapVersion])

  function centerOnFollowPoint() {
    const map = mapRef.current
    const point = pointsRef.current.find((item) => item.id === followPointId)
    const latlng = point ? pointLatLng(point) : null
    if (!map || !latlng) return
    map.flyTo(latlng, Math.max(map.getZoom(), 14), { duration: 0.45 })
  }

  function toggleFollow() {
    const next = !follow
    setFollow(next)
    if (next) centerOnFollowPoint()
  }

  function fitAll() {
    const map = mapRef.current
    if (!map) return
    fitMap(map, pointsRef.current, true)
  }

  return <div className={`osm-map ${className}`.trim()}>
    <div className="osm-map-frame">
      <div
        ref={mapNodeRef}
        className="osm-map-canvas"
        role="region"
        aria-label={ariaLabel}
      />
      <div className="osm-map-controls" role="group" aria-label="Map controls">
        <button type="button" className="osm-map-control" aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
        <button type="button" className="osm-map-control" aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
        <button type="button" className="osm-map-control" aria-label="Fit all stops" title="Fit all stops" onClick={fitAll}><Icon name="route" size={13} /></button>
        {followPointId && <button type="button" className={`osm-map-control ${follow ? 'active' : ''}`} aria-label={follow ? 'Stop following the delivery partner' : 'Follow the delivery partner'} aria-pressed={follow} title={follow ? 'Stop following the delivery partner' : 'Follow the delivery partner'} onClick={toggleFollow}><Icon name="locate" size={13} /></button>}
      </div>
      <span className="osm-map-badge">OpenStreetMap</span>
      <a className="osm-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      {interactive && <span className="osm-map-hint">Click map to place · drag to pan · scroll to zoom</span>}
      {!ready && <span className="osm-map-loading">Loading map…</span>}
      {ready && points.length === 0 && <span className="osm-map-loading">No route to preview.</span>}
    </div>
  </div>
}

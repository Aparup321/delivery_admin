import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui'

export interface MapPoint {
  id: string
  label: string
  latitude: number
  longitude: number
  kind?: 'pickup' | 'drop' | 'neutral'
}

interface MapPreviewProps {
  points: MapPoint[]
  ariaLabel: string
  className?: string
}

const TILE_SIZE = 256
const MIN_ZOOM = 9
const MAX_ZOOM = 14

interface Viewport {
  width: number
  height: number
}

interface ProjectedPoint {
  point: MapPoint
  x: number
  y: number
}

interface MapTile {
  key: string
  src: string
  left: number
  top: number
}

interface MapLayout {
  tiles: MapTile[]
  markers: Array<ProjectedPoint & { left: number; top: number }>
}

/** Web Mercator projection in world pixels at a fixed zoom. */
function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom
  const clampedLatitude = Math.max(-85.0511, Math.min(85.0511, latitude))

  return {
    x: ((longitude + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log(
          (1 + Math.sin((clampedLatitude * Math.PI) / 180)) /
            (1 - Math.sin((clampedLatitude * Math.PI) / 180)),
        ) /
          (4 * Math.PI)) *
      scale,
  }
}

function zoomFor(points: MapPoint[], width: number, height: number) {
  const paddingX = Math.min(110, width * 0.24)
  const paddingY = Math.min(44, height * 0.24)

  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const projected = points.map((point) => project(point.latitude, point.longitude, zoom))
    const spanX = Math.max(...projected.map((item) => item.x)) - Math.min(...projected.map((item) => item.x))
    const spanY = Math.max(...projected.map((item) => item.y)) - Math.min(...projected.map((item) => item.y))

    if (spanX <= width - paddingX * 2 && spanY <= height - paddingY * 2) {
      return zoom
    }
  }

  return MIN_ZOOM
}

function layoutFor(points: MapPoint[], width: number, height: number): MapLayout {
  const zoom = zoomFor(points, width, height)
  const projected: ProjectedPoint[] = points.map((point) => ({
    point,
    ...project(point.latitude, point.longitude, zoom),
  }))
  const minX = Math.min(...projected.map((item) => item.x))
  const maxX = Math.max(...projected.map((item) => item.x))
  const minY = Math.min(...projected.map((item) => item.y))
  const maxY = Math.max(...projected.map((item) => item.y))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const tileCount = 2 ** zoom
  const minTileX = Math.floor((centerX - width / 2) / TILE_SIZE)
  const maxTileX = Math.floor((centerX + width / 2) / TILE_SIZE)
  const minTileY = Math.floor((centerY - height / 2) / TILE_SIZE)
  const maxTileY = Math.floor((centerY + height / 2) / TILE_SIZE)
  const tiles: MapTile[] = []

  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (y < 0 || y >= tileCount) continue
      const wrappedX = ((x % tileCount) + tileCount) % tileCount
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
        left: width / 2 + x * TILE_SIZE - centerX,
        top: height / 2 + y * TILE_SIZE - centerY,
      })
    }
  }

  const markers = projected.map((item) => ({
    ...item,
    left: width / 2 + item.x - centerX,
    top: height / 2 + item.y - centerY,
  }))

  return { tiles, markers }
}

/**
 * Non-interactive OpenStreetMap preview rendered from the public raster tile
 * service. It uses no API key or library, matching the map source used by
 * delivery_app. Routing, live GPS and ETAs remain demo data.
 */
export function MapPreview({ points, ariaLabel, className = '' }: MapPreviewProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 })
  const [failedTiles, setFailedTiles] = useState<string[]>([])

  useEffect(() => {
    const node = canvasRef.current
    if (!node) return

    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight })
    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(
    () => (points.length && viewport.width > 40 && viewport.height > 40
      ? layoutFor(points, viewport.width, viewport.height)
      : null),
    [points, viewport],
  )
  const allTilesFailed = layout
    ? layout.tiles.length > 0 && layout.tiles.every((tile) => failedTiles.includes(tile.key))
    : false

  return <div className={`osm-map ${className}`.trim()}>
    <div ref={canvasRef} className="osm-map-canvas" role="img" aria-label={ariaLabel}>
      {layout?.tiles.map((tile) => failedTiles.includes(tile.key) ? null : <img
        key={tile.key}
        className="osm-map-tile"
        src={tile.src}
        alt=""
        draggable={false}
        decoding="async"
        style={{ left: tile.left, top: tile.top }}
        onError={() => setFailedTiles((current) => current.includes(tile.key) ? current : [...current, tile.key])}
      />)}
      {layout?.markers.map((marker) => <span
        key={marker.point.id}
        className={`osm-map-marker osm-map-marker-${marker.point.kind ?? 'neutral'}`}
        style={{ left: marker.left, top: marker.top }}
        title={marker.point.label}
      >
        <i /><b>{marker.point.label}</b>
      </span>)}
      {!layout && <span className="osm-map-loading">{points.length ? 'Loading map…' : 'No route to preview.'}</span>}
      {allTilesFailed && <span className="osm-map-failure"><Icon name="alert" size={14} />OpenStreetMap tiles could not load. Check the network connection.</span>}
      <span className="osm-map-badge">OpenStreetMap</span>
      <a className="osm-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
    </div>
  </div>
}

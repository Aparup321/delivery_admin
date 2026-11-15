/**
 * Coordinates for the demo service areas used by the admin console.
 *
 * Delivery records store area names rather than GPS points. Keeping the
 * lookup here lets the OpenStreetMap preview place stable, real-world markers
 * without geocoding every render or adding an API key.
 */

export interface MapCoordinate {
  latitude: number
  longitude: number
}

const KOLKATA_CENTER: MapCoordinate = { latitude: 22.5726, longitude: 88.3639 }

const SERVICE_AREA_COORDINATES: Record<string, MapCoordinate> = {
  barasat: { latitude: 22.7221, longitude: 88.4807 },
  newtown: { latitude: 22.5867, longitude: 88.467 },
  saltlake: { latitude: 22.5726, longitude: 88.416 },
  dumdum: { latitude: 22.62, longitude: 88.42 },
  kolkata: { latitude: 22.5726, longitude: 88.3639 },
  rajarhat: { latitude: 22.61, longitude: 88.47 },
  laketown: { latitude: 22.61, longitude: 88.398 },
  sectorv: { latitude: 22.5727, longitude: 88.431 },
  bidhannagar: { latitude: 22.5867, longitude: 88.4171 },
  kestopur: { latitude: 22.595, longitude: 88.41 },
  ballygunge: { latitude: 22.524, longitude: 88.365 },
  parkstreet: { latitude: 22.5535, longitude: 88.352 },
}

function normalizeArea(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Resolve a delivery area name to demo coordinates, falling back to Kolkata. */
export function serviceAreaCoordinate(area: string): MapCoordinate {
  return SERVICE_AREA_COORDINATES[normalizeArea(area)] ?? KOLKATA_CENTER
}

/** True when the area has a specific coordinate rather than the Kolkata fallback. */
export function hasServiceAreaCoordinate(area: string) {
  return Boolean(SERVICE_AREA_COORDINATES[normalizeArea(area)])
}

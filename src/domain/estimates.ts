/**
 * Route estimates the console sends with every assigned delivery so the
 * partner app can show distance, ETA and payout without a routing provider.
 *
 * Distances come from the demo service-area coordinates and are therefore
 * approximations; the payout default is a suggestion the Administrator edits
 * before assigning. Neither value is a billing figure.
 */

import { serviceAreaCoordinate } from './serviceAreas.ts'

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const earthRadiusKm = 6371
  const deltaLatitude = ((b.latitude - a.latitude) * Math.PI) / 180
  const deltaLongitude = ((b.longitude - a.longitude) * Math.PI) / 180
  const latitudeA = (a.latitude * Math.PI) / 180
  const latitudeB = (b.latitude * Math.PI) / 180

  const h =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2

  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Distance between two service areas in km, floored at 1 km and rounded. */
export function areaDistanceKm(pickup: string, drop: string): number {
  const distance = haversineKm(serviceAreaCoordinate(pickup), serviceAreaCoordinate(drop))
  return Math.max(1, Math.round(distance * 10) / 10)
}

/** Road-time estimate for a distance inside the city. */
export function estimateEtaMinutes(distanceKm: number): number {
  return Math.max(8, Math.ceil(distanceKm * 4 + 6))
}

/** Suggested partner payout, rounded to the nearest ₹5. */
export function estimatePartnerEarnings(distanceKm: number): number {
  return Math.round((35 + distanceKm * 12) / 5) * 5
}

/** 4-digit customer code used to verify the drop. */
export function createDropOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

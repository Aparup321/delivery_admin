const DAY_MS = 24 * 60 * 60 * 1000

export const MIN_SUSPENSION_DAYS = 1
export const MAX_SUSPENSION_DAYS = 365
export const DEFAULT_SUSPENSION_DAYS = 7

/** The automatic reinstatement deadline for a suspension that starts at `at`. */
export function suspensionEnd(at: string, days: number) {
  return new Date(new Date(at).getTime() + days * DAY_MS).toISOString()
}

export function isValidSuspensionDays(value: number) {
  return Number.isInteger(value) && value >= MIN_SUSPENSION_DAYS && value <= MAX_SUSPENSION_DAYS
}

export function suspensionDaysLabel(days: number) {
  return `${days} day${days === 1 ? '' : 's'}`
}

export function formatSuspensionEnd(until: string | null) {
  if (!until) return null
  const date = new Date(until)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

/** Short display used on directory rows and profile summaries. */
export function suspensionTimeline(days: number | null, until: string | null) {
  const end = formatSuspensionEnd(until)
  if (!days || !end) return null
  return `${suspensionDaysLabel(days)} · ends ${end}`
}

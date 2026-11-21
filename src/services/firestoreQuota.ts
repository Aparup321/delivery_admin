/**
 * Firestore enforces its free daily read quota per project and returns HTTP 429
 * with `RESOURCE_EXHAUSTED` / "Quota exceeded." once it is used up. The quota
 * resets at midnight Pacific Time, so polling has to stop for the rest of the
 * day instead of retrying every few minutes and showing the same failure.
 *
 * The block is persisted per Firebase project so a page reload, Vite hot update
 * or second tab does not immediately make another failing request, and so
 * switching to a different project is not blocked by another project's quota.
 */

const QUOTA_BLOCK_KEY = 'picdrop-hopngo.firestore-quota-blocked-until'
const PACIFIC_TIME_ZONE = 'America/Los_Angeles'

export interface QuotaState {
  blockedUntil: number
  message: string
}

function blockKey(projectId?: string) {
  const id = projectId?.trim()
  return id ? `${QUOTA_BLOCK_KEY}:${id}` : QUOTA_BLOCK_KEY
}

function timeZoneParts(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  return Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>
}

/** Converts a wall-clock time in `timeZone` to its UTC epoch timestamp. */
function zonedTimeToUtc(year: number, month: number, day: number, timeZone: string) {
  let guess = Date.UTC(year, month - 1, day)
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = timeZoneParts(new Date(guess), timeZone)
    const rendered = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    guess += Date.UTC(year, month - 1, day) - rendered
  }
  return guess
}

/** The next midnight in Pacific Time, when the Firestore daily quota resets. */
export function nextQuotaResetAt(now = Date.now()) {
  const today = timeZoneParts(new Date(now), PACIFIC_TIME_ZONE)
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day) + 24 * 60 * 60_000)
  return zonedTimeToUtc(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    PACIFIC_TIME_ZONE,
  )
}

export function isQuotaError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''
  const lower = message.toLowerCase()
  return message.includes('HTTP 429')
    || lower.includes('quota exceeded')
    || lower.includes('resource_exhausted')
    || lower.includes('resource exhausted')
}

export function quotaMessage(blockedUntil: number) {
  const reset = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: PACIFIC_TIME_ZONE,
  }).format(new Date(blockedUntil))
  return `Firestore's daily read quota is exhausted. Live sync is paused until the quota resets (${reset}); cached data remains available.`
}

/** Returns the active persisted block for a project, clearing an expired one. */
export function readQuotaBlockedUntil(projectId?: string) {
  if (typeof window === 'undefined') return 0
  const key = blockKey(projectId)
  try {
    const saved = Number(window.localStorage.getItem(key))
    if (Number.isFinite(saved) && saved > Date.now()) return saved
    if (saved) window.localStorage.removeItem(key)
  } catch {
    // Storage may be blocked; the in-memory request guard still applies.
  }
  return 0
}

/** The user-facing pause notice while the project's quota block is active. */
export function activeQuotaMessage(projectId?: string) {
  const blockedUntil = readQuotaBlockedUntil(projectId)
  return blockedUntil ? quotaMessage(blockedUntil) : null
}

/**
 * Persists a quota block until the next daily reset and returns the active
 * quota state. Non-quota failures return null so callers can keep their
 * existing error handling.
 */
export function blockQuotaUntilReset(error: unknown, projectId?: string): QuotaState | null {
  if (!isQuotaError(error)) return null
  const blockedUntil = nextQuotaResetAt()
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(blockKey(projectId), String(blockedUntil))
    }
  } catch {
    // The current session still receives the friendly message.
  }
  return { blockedUntil, message: quotaMessage(blockedUntil) }
}

export function clearQuotaBlock(projectId?: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(blockKey(projectId))
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** Converts a quota failure into a user-facing message; other errors pass through. */
export function describeSyncError(error: unknown, fallback: string, projectId?: string) {
  const quota = blockQuotaUntilReset(error, projectId)
  if (quota) return quota.message
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

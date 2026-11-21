import { useCallback, useEffect, useState } from 'react'
import type { PartnerAppConfig } from '../domain/model'
import {
  fetchLiveDeliveriesCached,
  invalidateLiveDeliveries,
  readCachedLiveDeliveries,
  readLiveDeliveryToken,
  type LiveDelivery,
} from '../services/liveDeliveries'
import {
  activeQuotaMessage,
  clearQuotaBlock,
  describeSyncError,
} from '../services/firestoreQuota'

interface LiveDeliveriesState {
  deliveries: LiveDelivery[]
  error: string | null
  loading: boolean
}

interface LiveDeliveriesOptions {
  /** Refresh cadence while the page is visible. Defaults to one minute. */
  pollIntervalMs?: number
  /** How long a shared read may be reused for this page. */
  cacheMaxAgeMs?: number
}

/**
 * Polls the delivery collection written by delivery_app. Firestore REST has no
 * live subscription, so pages refresh on the configured interval (one minute by
 * default; the Tracking page uses 15 seconds), on tab focus and after an
 * explicit retry. Reads are shared with the provider and
 * other open pages, and stop entirely until the daily reset when Firestore
 * answers 429 Quota exceeded.
 */
export function useLiveDeliveries(
  config: PartnerAppConfig,
  enabled = true,
  options: LiveDeliveriesOptions = {},
): LiveDeliveriesState & { refresh: () => void } {
  const pollIntervalMs = options.pollIntervalMs ?? 60_000
  const cacheMaxAgeMs = options.cacheMaxAgeMs ?? 30_000
  const [state, setState] = useState<LiveDeliveriesState>(() => ({
    deliveries: readCachedLiveDeliveries(config, cacheMaxAgeMs) ?? [],
    error: activeQuotaMessage(config.projectId),
    loading: false,
  }))
  const [refreshToken, setRefreshToken] = useState(0)
  const configKey = [
    config.mode,
    config.projectId,
    config.databaseId,
    config.apiKey,
    config.lastSyncAt ?? '',
  ].join('|')

  useEffect(() => {
    if (!enabled || config.mode !== 'firestore' || !config.projectId.trim()) {
      setState({ deliveries: [], error: null, loading: false })
      return
    }

    let active = true

    const load = async (showLoading: boolean) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const paused = activeQuotaMessage(config.projectId)
      if (paused) {
        if (active) {
          setState((current) => current.error === paused && !current.loading
            ? current
            : { ...current, error: paused, loading: false })
        }
        return
      }
      if (showLoading) {
        setState((current) => ({ ...current, loading: true }))
      }

      try {
        const deliveries = await fetchLiveDeliveriesCached(
          config,
          readLiveDeliveryToken(),
          cacheMaxAgeMs,
        )
        if (active) {
          setState({ deliveries, error: null, loading: false })
        }
      } catch (error) {
        if (!active) return
        setState((current) => ({
          ...current,
          error: describeSyncError(error, 'Could not load live deliveries.', config.projectId),
          loading: false,
        }))
      }
    }

    void load(true)
    const timer = window.setInterval(() => {
      void load(false)
    }, pollIntervalMs)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load(false)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // configKey captures every connection value that changes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, enabled, refreshToken, pollIntervalMs, cacheMaxAgeMs])

  const refresh = useCallback(() => {
    // An explicit retry is the operator's decision: drop the shared cache and
    // the quota pause so one real request measures the current quota state.
    invalidateLiveDeliveries()
    clearQuotaBlock(config.projectId)
    setRefreshToken((value) => value + 1)
  }, [config.projectId])

  return { ...state, refresh }
}

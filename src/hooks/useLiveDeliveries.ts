import { useCallback, useEffect, useState } from 'react'
import type { PartnerAppConfig } from '../domain/model'
import {
  fetchLiveDeliveries,
  readLiveDeliveryToken,
  type LiveDelivery,
} from '../services/liveDeliveries'

interface LiveDeliveriesState {
  deliveries: LiveDelivery[]
  error: string | null
  loading: boolean
}

/**
 * Polls the delivery collection written by delivery_app. Firestore REST has no
 * live subscription, so the admin overview refreshes on an interval and after
 * an explicit retry.
 */
export function useLiveDeliveries(
  config: PartnerAppConfig,
  enabled = true,
): LiveDeliveriesState & { refresh: () => void } {
  const [state, setState] = useState<LiveDeliveriesState>({
    deliveries: [],
    error: null,
    loading: false,
  })
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
    // Every poll reads documents against the project's daily Firestore quota.
    // Poll at most once a minute, pause while the tab is hidden, and back off
    // for ten minutes when Firestore answers 429 Quota exceeded.
    let quotaBlockedUntil = 0

    const load = async (showLoading: boolean) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (Date.now() < quotaBlockedUntil) return
      if (showLoading) {
        setState((current) => ({ ...current, loading: true }))
      }

      try {
        const deliveries = await fetchLiveDeliveries(
          config,
          readLiveDeliveryToken(),
        )
        if (active) {
          setState({ deliveries, error: null, loading: false })
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'Could not load live deliveries.'
          if (message.includes('HTTP 429') || message.toLowerCase().includes('quota')) {
            quotaBlockedUntil = Date.now() + 10 * 60_000
          }
          setState((current) => ({
            ...current,
            error: message,
            loading: false,
          }))
        }
      }
    }

    void load(true)
    const timer = window.setInterval(() => {
      void load(false)
    }, 60_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
    // configKey captures every connection value that changes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, enabled, refreshToken])

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1)
  }, [])

  return { ...state, refresh }
}

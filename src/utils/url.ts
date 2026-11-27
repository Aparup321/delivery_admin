/** Only absolute HTTP(S) URLs may be rendered as external links. */
export function safeExternalUrl(value: string | null | undefined) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Diagnostics may render a request URL. Redact query values that commonly
 * carry credentials so an API key or token does not end up in the UI.
 */
export function redactUrlSecrets(value: string) {
  try {
    const url = new URL(value)
    for (const key of ['key', 'token', 'access_token', 'refresh_token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, 'redacted')
    }
    return url.toString()
  } catch {
    return ''
  }
}

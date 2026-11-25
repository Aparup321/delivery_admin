/**
 * Firebase Authentication for the delivery_admin console.
 *
 * Administrator sign-in uses Firebase Authentication. This module exchanges
 * credentials with the Identity Toolkit REST API and authorizes Firestore
 * reads and writes against the delivery_app project. The refresh token is
 * persisted so the console reconnects automatically on later runs; the
 * short-lived ID token is refreshed on demand.
 */

export interface FirebaseAdminSession {
  uid: string
  email: string
  displayName?: string
  idToken: string
  refreshToken: string
  expiresAt: number
  signedInAt: string
}

const SESSION_KEY = 'picdrop-firebase-admin-session-v1'
const PERSISTED_SESSION_KEY = 'picdrop-firebase-admin-session-persisted-v1'

let memorySession: FirebaseAdminSession | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isSession(value: unknown): value is FirebaseAdminSession {
  return isRecord(value)
    && typeof value.uid === 'string'
    && typeof value.email === 'string'
    && typeof value.idToken === 'string'
    && typeof value.refreshToken === 'string'
    && typeof value.expiresAt === 'number'
    && typeof value.signedInAt === 'string'
}

function readStoredSession(key: string, storage: 'sessionStorage' | 'localStorage') {
  try {
    const raw = window[storage].getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function readFirebaseAdminSession(): FirebaseAdminSession | null {
  if (memorySession) return memorySession
  const active = readStoredSession(SESSION_KEY, 'sessionStorage')
  if (active) {
    memorySession = active
    return active
  }
  // A persisted session keeps the two apps connected across restarts. Its ID
  // token is empty until the first Firestore request refreshes it.
  const persisted = readStoredSession(PERSISTED_SESSION_KEY, 'localStorage')
  if (!persisted) return null
  memorySession = persisted
  return persisted
}

export function storeFirebaseAdminSession(session: FirebaseAdminSession) {
  memorySession = session
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // The session still works for this page view when storage is unavailable.
  }
  try {
    // Keep only the long-lived refresh token on disk; ID tokens are renewed.
    const persisted: FirebaseAdminSession = { ...session, idToken: '', expiresAt: 0 }
    window.localStorage.setItem(PERSISTED_SESSION_KEY, JSON.stringify(persisted))
  } catch {
    // Persistence is optional when storage is unavailable.
  }
}

export function clearFirebaseAdminSession() {
  memorySession = null
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
  try {
    window.localStorage.removeItem(PERSISTED_SESSION_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export class FirebaseAuthRequestError extends Error {
  readonly code: string
  constructor(message: string, code = '') {
    super(message)
    this.name = 'FirebaseAuthRequestError'
    this.code = code
  }
}

function authErrorMessage(code: string) {
  switch (code) {
    case 'EMAIL_NOT_FOUND':
    case 'INVALID_PASSWORD':
    case 'INVALID_LOGIN_CREDENTIALS':
      return 'Firebase rejected that email and password.'
    case 'USER_DISABLED':
      return 'This Firebase administrator account is disabled.'
    case 'OPERATION_NOT_ALLOWED':
      return 'Email/password sign-in is disabled in Firebase Authentication. Enable it in Firebase Console → Authentication → Sign-in method.'
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
      return 'Too many sign-in attempts. Wait a few minutes and try again.'
    case 'API_KEY_INVALID':
    case 'INVALID_API_KEY':
      return 'The Firebase web API key is invalid. Check VITE_FIREBASE_API_KEY in .env.local.'
    case 'MISSING_PASSWORD':
      return 'Enter the Firebase administrator password.'
    default:
      return 'Firebase Authentication rejected the request. Check the project, API key, and Email/Password sign-in provider.'
  }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new FirebaseAuthRequestError(`Could not reach Firebase Authentication.${error instanceof Error ? ` (${error.message})` : ''}`)
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // The response had no JSON body.
  }
  if (!response.ok) {
    const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    const code = errorBody ? asString(errorBody.message) : ''
    throw new FirebaseAuthRequestError(`${authErrorMessage(code)}${code && !authErrorMessage(code).includes(code) ? ` (${code})` : ''}`, code)
  }
  return payload
}

function sessionFromAuthResponse(payload: unknown, fallbackEmail: string): FirebaseAdminSession {
  if (!isRecord(payload)) throw new FirebaseAuthRequestError('Firebase Authentication returned an unexpected response.')
  const idToken = asString(payload.idToken)
  const refreshToken = asString(payload.refreshToken)
  const uid = asString(payload.localId)
  const expiresIn = Number(payload.expiresIn)
  if (!idToken || !refreshToken || !uid || !Number.isFinite(expiresIn)) {
    throw new FirebaseAuthRequestError('Firebase Authentication did not return a usable session.')
  }
  return {
    uid,
    email: asString(payload.email) || fallbackEmail,
    displayName: asString(payload.displayName) || undefined,
    idToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    signedInAt: new Date().toISOString(),
  }
}

export async function signInFirebaseAdmin(email: string, password: string, apiKey: string): Promise<FirebaseAdminSession> {
  const normalizedEmail = email.trim()
  if (!apiKey.trim()) throw new FirebaseAuthRequestError('Save the Firebase project and web API key before signing in.')
  if (!normalizedEmail) throw new FirebaseAuthRequestError('Enter the Firebase administrator email.')
  if (!password) throw new FirebaseAuthRequestError('Enter the Firebase administrator password.')
  const payload = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey.trim())}`,
    { email: normalizedEmail, password, returnSecureToken: true },
  )
  const session = sessionFromAuthResponse(payload, normalizedEmail)
  storeFirebaseAdminSession(session)
  return session
}

async function refreshSession(session: FirebaseAdminSession, apiKey: string): Promise<FirebaseAdminSession> {
  if (!apiKey.trim()) throw new FirebaseAuthRequestError('The Firebase web API key is missing, so the admin session cannot be refreshed.')
  let response: Response
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), 20_000)
  try {
    response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
      signal: controller.signal,
    })
  } catch (error) {
    const name = typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : ''
    if (name === 'AbortError') {
      clearFirebaseAdminSession()
      throw new FirebaseAuthRequestError(
        'The Firebase administrator session refresh timed out after 20 seconds. Sign in again from Settings → Partner app.',
      )
    }
    throw new FirebaseAuthRequestError(`Could not refresh the Firebase administrator session.${error instanceof Error ? ` (${error.message})` : ''}`)
  } finally {
    globalThis.clearTimeout(timer)
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // The response had no JSON body.
  }
  if (!response.ok || !isRecord(payload)) {
    clearFirebaseAdminSession()
    throw new FirebaseAuthRequestError('The Firebase administrator session expired. Sign in again from Settings → Partner app.')
  }
  const idToken = asString(payload.id_token)
  const refreshToken = asString(payload.refresh_token) || session.refreshToken
  const expiresIn = Number(payload.expires_in)
  if (!idToken || !Number.isFinite(expiresIn)) {
    clearFirebaseAdminSession()
    throw new FirebaseAuthRequestError('The Firebase administrator session could not be refreshed. Sign in again.')
  }
  const refreshed: FirebaseAdminSession = {
    ...session,
    idToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  storeFirebaseAdminSession(refreshed)
  return refreshed
}

/** Returns a valid ID token, refreshing it shortly before expiry. */
export async function getFirebaseAdminIdToken(apiKey: string): Promise<string> {
  const session = readFirebaseAdminSession()
  if (!session) return ''
  if (session.idToken && session.expiresAt - 60_000 > Date.now()) return session.idToken
  const refreshed = await refreshSession(session, apiKey)
  return refreshed.idToken
}

/**
 * Prefers a manually pasted token, then the signed-in Firebase administrator.
 * Returns an empty string when neither is available.
 */
export async function resolvePartnerAppToken(pastedToken: string, apiKey: string): Promise<string> {
  const pasted = pastedToken.trim()
  if (pasted) return pasted
  return getFirebaseAdminIdToken(apiKey)
}

export function hasFirebaseAdminSession() {
  return Boolean(readFirebaseAdminSession())
}

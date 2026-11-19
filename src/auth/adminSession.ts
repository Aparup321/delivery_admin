import { demoModeEnabled, isAdminEmailAllowed } from '../config/firebase.ts'
import { clearFirebaseAdminSession, readFirebaseAdminSession, type FirebaseAdminSession } from '../services/firebaseAuth.ts'
import { clearPartnerAppToken } from '../services/partnerApp.ts'

export const DEMO_LOGIN_EMAIL = 'admin@picdrop.demo'
export const DEMO_OTP_CODE = '123456'

const DEMO_SESSION_KEY = 'picdrop-demo-admin-session-v1'

export interface AdminSession {
  userId: string
  name: string
  email: string
  signedInAt: string
  mode: 'Firebase Authentication' | 'Demo access'
}

function fallbackName(email: string) {
  const localPart = email.split('@')[0]?.trim()
  if (!localPart) return 'Operations Administrator'
  return localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

/** Maps the Firebase identity to the console's Administrator session. */
export function createAdminSession(firebase: FirebaseAdminSession): AdminSession {
  return {
    userId: firebase.uid,
    name: firebase.displayName?.trim() || fallbackName(firebase.email),
    email: firebase.email,
    signedInAt: firebase.signedInAt,
    mode: 'Firebase Authentication',
  }
}

export function createDemoAdminSession(): AdminSession {
  return {
    userId: 'DEMO-OPS-01',
    name: 'Operations Administrator',
    email: DEMO_LOGIN_EMAIL,
    signedInAt: new Date().toISOString(),
    mode: 'Demo access',
  }
}

export function readDemoAdminSession(): AdminSession | null {
  try {
    const raw = window.sessionStorage.getItem(DEMO_SESSION_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<AdminSession>
    if (candidate.mode !== 'Demo access' || !candidate.userId || !candidate.email || !candidate.signedInAt) return null
    return {
      userId: candidate.userId,
      name: candidate.name?.trim() || 'Operations Administrator',
      email: candidate.email,
      signedInAt: candidate.signedInAt,
      mode: 'Demo access',
    }
  } catch {
    return null
  }
}

export function storeDemoAdminSession(session: AdminSession = createDemoAdminSession()) {
  try {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session))
  } catch {
    // The demo still works for this page view when session storage is unavailable.
  }
}

export function clearDemoAdminSession() {
  try {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY)
  } catch {
    // Nothing to clear when session storage is unavailable.
  }
}

export function isDemoOtpValid(code: string) {
  return code.trim() === DEMO_OTP_CODE
}

export function readAdminSession(): AdminSession | null {
  if (demoModeEnabled) {
    const demo = readDemoAdminSession()
    if (demo) return demo
  }
  const firebase = readFirebaseAdminSession()
  if (!firebase) return null
  if (!isAdminEmailAllowed(firebase.email)) {
    clearAdminSession()
    return null
  }
  return createAdminSession(firebase)
}

export function clearAdminSession() {
  clearFirebaseAdminSession()
  clearDemoAdminSession()
  clearPartnerAppToken()
  return true
}

/** Opens the Firebase form to attach live data while keeping demo access. */
export function beginFirebaseDataConnection() {
  clearFirebaseAdminSession()
  clearPartnerAppToken()
  window.location.assign('/admin?signin=firebase&connect=data')
}

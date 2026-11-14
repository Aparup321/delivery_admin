import { DEMO_ADMIN_EMAIL, createDemoAdmin } from '../domain/admin.ts'

export const DEMO_ADMIN_PASSWORD = 'demo-admin'
const SESSION_KEY = 'picdrop-hopngo-admin-session-v1'

export interface AdminSession {
  userId: string
  name: string
  email: string
  role: 'Admin'
  signedInAt: string
  mode: 'Local demo'
}

export function validateDemoAdminCredentials(email: string, password: string) {
  return email.trim().toLowerCase() === DEMO_ADMIN_EMAIL && password === DEMO_ADMIN_PASSWORD
}

export function createAdminSession(signedInAt = new Date().toISOString()): AdminSession {
  const admin = createDemoAdmin()
  return {
    userId: admin.id,
    name: admin.name,
    email: admin.email,
    role: 'Admin',
    signedInAt,
    mode: 'Local demo',
  }
}

export function persistAdminSession(session: AdminSession) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return true
  } catch {
    return false
  }
}

export function readAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = window.sessionStorage.getItem(SESSION_KEY)
    if (!saved) return null
    const parsed: unknown = JSON.parse(saved)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<AdminSession>
    if (candidate.role !== 'Admin' || candidate.email !== DEMO_ADMIN_EMAIL || !candidate.signedInAt) return null
    return {
      userId: candidate.userId ?? 'ADM-OPS-01',
      name: candidate.name ?? 'Operations Admin',
      email: DEMO_ADMIN_EMAIL,
      role: 'Admin',
      signedInAt: candidate.signedInAt,
      mode: 'Local demo',
    }
  } catch {
    return null
  }
}

export function clearAdminSession() {
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
    return true
  } catch {
    return false
  }
}
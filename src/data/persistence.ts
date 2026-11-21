import { applyFirebaseConnectionDefaults } from '../config/firebase.ts'
import { createDefaultAdmin, createDemoAdminDirectory, normalizeAdminAccess, normalizeAdminEmail } from '../domain/admin.ts'
import type { AdminAccount, AdminSection, OperationsState, Permission } from '../domain/model'
import { createEmptyState, DEMO_PARTNER_PHONES } from '../domain/seed.ts'

const STORAGE_KEY = 'picdrop-hopngo-operations-v4'

function isOperationsState(value: unknown): value is OperationsState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OperationsState>
  return candidate.schemaVersion === 3
    && Array.isArray(candidate.deliveries)
    && Array.isArray(candidate.partners)
    && Array.isArray(candidate.applications)
    && Boolean(candidate.partnerApp)
    && Array.isArray(candidate.partnerAppRecords)
    && Array.isArray(candidate.documents)
    && Array.isArray(candidate.assignments)
    && Array.isArray(candidate.offers)
    && Array.isArray(candidate.notifications)
    && Array.isArray(candidate.auditLogs)
    && Boolean(candidate.user)
    && Boolean(candidate.settings)
}

function linkedRecordId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeAdminAccount(value: unknown): AdminAccount | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AdminAccount>
  if (!candidate.id || !candidate.name || !candidate.email) return null
  const role = candidate.role === 'Main Administrator' ? 'Main Administrator' : 'Restricted Administrator'
  const access = normalizeAdminAccess(
    role,
    Array.isArray(candidate.sections) ? candidate.sections.filter((section): section is AdminSection => typeof section === 'string') : [],
    Array.isArray(candidate.permissions) ? candidate.permissions.filter((permission): permission is Permission => typeof permission === 'string') : [],
  )
  return {
    id: candidate.id,
    name: candidate.name.trim() || candidate.email,
    email: normalizeAdminEmail(candidate.email),
    role,
    title: candidate.title?.trim() || 'Delivery Operations Administrator',
    maskedPhone: candidate.maskedPhone?.trim() || 'Not provided',
    sections: access.sections,
    permissions: access.permissions,
    active: candidate.active !== false,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    lastSignedInAt: typeof candidate.lastSignedInAt === 'string' ? candidate.lastSignedInAt : null,
  }
}

/**
 * Repairs an older or hand-edited directory: email addresses stay unique,
 * there are never more than two active main administrators, and at least one
 * active main administrator always remains.
 */
function normalizeAdminDirectory(value: unknown): AdminAccount[] {
  const parsed = Array.isArray(value)
    ? value.map(normalizeAdminAccount).filter((account): account is AdminAccount => Boolean(account))
    : []
  const unique = new Map<string, AdminAccount>()
  for (const account of parsed) {
    if (!unique.has(account.email)) unique.set(account.email, account)
  }
  const accounts = [...unique.values()]
  if (!accounts.length) return createDemoAdminDirectory()

  const activeMains = accounts.filter((account) => account.active && account.role === 'Main Administrator')
  for (const extra of activeMains.slice(2)) {
    extra.role = 'Restricted Administrator'
    const access = normalizeAdminAccess(extra.role, extra.sections, extra.permissions)
    extra.sections = access.sections
    extra.permissions = access.permissions
  }

  if (!accounts.some((account) => account.active && account.role === 'Main Administrator')) {
    const fallback = accounts.find((account) => account.active) ?? accounts[0]
    fallback.active = true
    fallback.role = 'Main Administrator'
    const access = normalizeAdminAccess(fallback.role, fallback.sections, fallback.permissions)
    fallback.sections = access.sections
    fallback.permissions = access.permissions
  }

  return accounts
}

function normalizeSavedState(parsed: OperationsState): OperationsState {
  // Older local records predate the delivery_app link fields and the
  // administrator directory. Normalize them so every record has a stable
  // shape. The signed-in identity is applied by the app shell after sign-in;
  // local storage never grants a different console role.
  return {
    ...parsed,
    user: createDefaultAdmin(),
    admins: normalizeAdminDirectory(parsed.admins),
    partnerApp: applyFirebaseConnectionDefaults(parsed.partnerApp),
    partners: parsed.partners.map((partner) => ({
      ...partner,
      demoPhone: typeof partner.demoPhone === 'string' ? partner.demoPhone : DEMO_PARTNER_PHONES[partner.id] ?? null,
      suspendedUntil: typeof partner.suspendedUntil === 'string' ? partner.suspendedUntil : null,
      suspensionDays: typeof partner.suspensionDays === 'number' ? partner.suspensionDays : null,
      partnerAppUid: linkedRecordId(partner.partnerAppUid),
    })),
    applications: parsed.applications.map((application) => ({
      ...application,
      partnerAppUid: linkedRecordId(application.partnerAppUid),
    })),
    partnerAppRecords: parsed.partnerAppRecords.map((record) => ({
      ...record,
      applicationStatus: typeof record.applicationStatus === 'string' ? record.applicationStatus : null,
      isOnline: typeof record.isOnline === 'boolean'
        ? record.isOnline
        : typeof record.status === 'string' && ['online', 'available'].includes(record.status.trim().toLowerCase())
          ? true
          : typeof record.status === 'string' && ['offline', 'unavailable'].includes(record.status.trim().toLowerCase())
            ? false
            : null,
    })),
    partnerAppTickets: Array.isArray(parsed.partnerAppTickets) ? parsed.partnerAppTickets : [],
    partnerAppDocuments: Array.isArray(parsed.partnerAppDocuments) ? parsed.partnerAppDocuments : [],
  }
}

export function loadOperationsState(): OperationsState {
  if (typeof window === 'undefined') return createEmptyState()
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return createEmptyState()
    const parsed: unknown = JSON.parse(saved)
    // Normalize older local records and seed an empty Firestore connector from
    // the environment values. The authenticated Firebase identity is applied by
    // the app shell after sign-in; local records never grant a different role.
    return isOperationsState(parsed) ? normalizeSavedState(parsed) : createEmptyState()
  } catch {
    return createEmptyState()
  }
}

export function saveOperationsState(state: OperationsState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearOperationsState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

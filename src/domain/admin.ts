import type { AdminAccount, AdminRole, AdminSection, AdminUser, Permission } from './model.ts'

export const DEFAULT_ADMIN_EMAIL = 'admin@picdrop.demo'
export const DEMO_RESTRICTED_ADMIN_EMAIL = 'dispatch@picdrop.demo'

/** Permissions that cannot be delegated to a restricted administrator. */
export const MAIN_ADMIN_ONLY_PERMISSIONS: Permission[] = ['application-review', 'admin']

export const ALL_PERMISSIONS: Permission[] = [
  'read',
  'assignment',
  'delivery-management',
  'partner-management',
  'document-review',
  'application-review',
  'settings',
  'admin',
]

export const ADMIN_SECTIONS: AdminSection[] = ['deliveries', 'partners', 'audit-logs', 'settings']

export const ADMIN_SECTION_OPTIONS: Array<{ section: AdminSection; label: string; detail: string }> = [
  { section: 'deliveries', label: 'Deliveries', detail: 'Open the delivery queue, delivery records, and assignment screens.' },
  { section: 'partners', label: 'Partners', detail: 'Open the partner directory, profiles, and KYC document status.' },
  { section: 'audit-logs', label: 'Audit Logs', detail: 'Review the append-only administrative audit history.' },
  { section: 'settings', label: 'Settings', detail: 'Open operational settings and live partner synchronization.' }
]

export const ADMIN_ACTION_OPTIONS: Array<{ permission: Permission; label: string; detail: string; section: AdminSection }> = [
  { permission: 'delivery-management', label: 'Manage deliveries', detail: 'Create, delay, cancel, and advance delivery records.', section: 'deliveries' },
  { permission: 'assignment', label: 'Assign partners', detail: 'Assign eligible partners and manage assignment offers.', section: 'deliveries' },
  { permission: 'partner-management', label: 'Manage partner accounts', detail: 'Create partners and restrict, suspend, or restore accounts.', section: 'partners' },
  { permission: 'document-review', label: 'Review KYC documents', detail: 'Verify or reject submitted partner documents.', section: 'partners' },
  { permission: 'settings', label: 'Change settings', detail: 'Save operations settings and connect the partner backend.', section: 'settings' },
]

export const PERMISSION_LABELS: Record<Permission, string> = {
  read: 'View operations records',
  assignment: 'Assign partners and manage offers',
  'delivery-management': 'Create and manage deliveries',
  'partner-management': 'Manage partner accounts',
  'document-review': 'Review KYC documents',
  'application-review': 'Approve or reject onboarding applications',
  settings: 'Change operations settings and partner sync',
  admin: 'Manage administrators and access',
}

const MAIN_ADMIN_ACCOUNT: AdminAccount = {
  id: 'ADM-OPS-01',
  name: 'Operations Administrator',
  email: DEFAULT_ADMIN_EMAIL,
  role: 'Main Administrator',
  title: 'Delivery Operations Administrator',
  maskedPhone: 'Not provided',
  sections: [...ADMIN_SECTIONS],
  permissions: [...ALL_PERMISSIONS],
  active: true,
  createdAt: '2026-01-05T09:00:00.000Z',
  lastSignedInAt: null,
}

const DEMO_RESTRICTED_ACCOUNT: AdminAccount = {
  id: 'ADM-DISPATCH-02',
  name: 'Demo Dispatch Coordinator',
  email: DEMO_RESTRICTED_ADMIN_EMAIL,
  role: 'Restricted Administrator',
  title: 'Delivery Operations Coordinator',
  maskedPhone: 'Not provided',
  sections: ['deliveries', 'partners'],
  permissions: ['read', 'assignment', 'delivery-management', 'partner-management', 'document-review'],
  active: true,
  createdAt: '2026-02-12T10:30:00.000Z',
  lastSignedInAt: null,
}

function cloneAccount(account: AdminAccount): AdminAccount {
  return {
    ...account,
    sections: [...account.sections],
    permissions: [...account.permissions],
  }
}

/** Seeded directory used by demo resets and first-run local state. */
export function createDemoAdminDirectory(): AdminAccount[] {
  return [cloneAccount(MAIN_ADMIN_ACCOUNT), cloneAccount(DEMO_RESTRICTED_ACCOUNT)]
}

export function adminUserFromAccount(account: AdminAccount, id = account.id): AdminUser {
  return {
    id: id.trim() || account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    title: account.title,
    maskedPhone: account.maskedPhone,
    sections: [...account.sections],
    permissions: [...account.permissions],
    provisioned: true,
  }
}

/** Fallback identity used before the signed-in account is resolved. */
export function createDefaultAdmin(): AdminUser {
  return adminUserFromAccount(MAIN_ADMIN_ACCOUNT)
}

export function normalizeAdminEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isMainAdministrator(user: Pick<AdminUser, 'role'> | Pick<AdminAccount, 'role'>) {
  return user.role === 'Main Administrator'
}

/** Allows an action when the account is active and has the required permission. */
export function userCan(user: Pick<AdminUser, 'role' | 'permissions' | 'provisioned'>, permission: Permission) {
  if (!user.provisioned) return false
  if (user.role === 'Main Administrator') return true
  if (MAIN_ADMIN_ONLY_PERMISSIONS.includes(permission)) return false
  return user.permissions.includes(permission)
}

/** Allows a console section when the account is active and has been granted it. */
export function userHasSection(user: Pick<AdminUser, 'role' | 'sections' | 'provisioned'>, section: AdminSection) {
  if (!user.provisioned) return false
  if (user.role === 'Main Administrator') return true
  return user.sections.includes(section)
}

/**
 * Main administrators always receive every section and action. Restricted
 * administrators cannot be granted onboarding approval or admin management,
 * and action access implies access to the section that hosts the action.
 */
export function normalizeAdminAccess(
  role: AdminRole,
  sections: AdminSection[],
  permissions: Permission[],
): Pick<AdminAccount, 'sections' | 'permissions'> {
  if (role === 'Main Administrator') {
    return { sections: [...ADMIN_SECTIONS], permissions: [...ALL_PERMISSIONS] }
  }

  const allowed = new Set(permissions.filter((permission) => ALL_PERMISSIONS.includes(permission) && !MAIN_ADMIN_ONLY_PERMISSIONS.includes(permission)))
  allowed.add('read')

  const allowedSections = new Set(sections.filter((section) => ADMIN_SECTIONS.includes(section)))
  if (allowed.has('delivery-management') || allowed.has('assignment')) allowedSections.add('deliveries')
  if (allowed.has('partner-management') || allowed.has('document-review')) allowedSections.add('partners')
  if (allowed.has('settings')) allowedSections.add('settings')

  return {
    sections: ADMIN_SECTIONS.filter((section) => allowedSections.has(section)),
    permissions: ALL_PERMISSIONS.filter((permission) => allowed.has(permission)),
  }
}

export function sectionLabels(sections: AdminSection[]) {
  return ADMIN_SECTION_OPTIONS.filter((option) => sections.includes(option.section)).map((option) => option.label)
}

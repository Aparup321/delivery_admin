import type { AdminUser } from './model.ts'

export const DEFAULT_ADMIN_EMAIL = 'operations@picdrop.internal'

export const ADMIN_PERMISSIONS = [
  'Manage deliveries, assignments, and delivery milestones',
  'Create partner records, approve or reject onboarding KYC applications, and verify documents',
  'Suspend, restrict, restore, and review partner activity and eligibility',
  'Connect the delivery_app partner backend and sync partner records',
  'Configure delivery operations and notification settings',
  'Review and export the administrative audit history',
]

/**
 * Fallback identity used before the Firebase-authenticated user is loaded into
 * the local operations state. The signed-in account replaces it at runtime.
 */
export function createDefaultAdmin(): AdminUser {
  return {
    id: 'ADM-OPS-01',
    name: 'Operations Administrator',
    email: DEFAULT_ADMIN_EMAIL,
    role: 'Admin',
    title: 'Delivery Operations Administrator',
    maskedPhone: 'Not provided',
  }
}

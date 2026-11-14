import type { AdminUser } from './model.ts'

export const DEMO_ADMIN_EMAIL = 'admin@picdrop.demo'

export const DEMO_ADMIN_PERMISSIONS = [
  'Manage deliveries, assignments, and delivery milestones',
  'Review partner applications, eligibility, restrictions, and KYC records',
  'Connect the delivery_app partner backend and sync partner records',
  'Configure delivery operations and notification settings',
  'Review and export the administrative audit history',
]

/**
 * The Operations team demo contains one Administrator account.
 * These details are illustrative and are not production identity records.
 */
export function createDemoAdmin(): AdminUser {
  return {
    id: 'ADM-OPS-01',
    name: 'Operations Admin',
    email: DEMO_ADMIN_EMAIL,
    role: 'Admin',
    title: 'Delivery Operations Administrator',
    maskedPhone: '+91 ••••• 4821',
  }
}
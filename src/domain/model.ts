export const DELIVERY_MILESTONES = [
  'Accepted',
  'Pickup Arrived',
  'Picked Up',
  'In Transit',
  'Drop Arrived',
  'Delivered',
] as const

export type DeliveryMilestoneName = (typeof DELIVERY_MILESTONES)[number]
export type DeliveryStatus = 'Pending' | 'Unassigned' | 'Assigned' | 'In Transit' | 'Delayed' | 'Completed' | 'Cancelled'
export type PackageSize = 'Small' | 'Medium' | 'Large' | 'Extra large'
export type VehicleType = 'Bike' | 'Scooter' | 'Van'
export type PartnerAvailability = 'Available' | 'On Delivery' | 'Offline' | 'Restricted' | 'Suspended'
export type DocumentStatus = 'Missing' | 'Submitted' | 'Under Review' | 'Verified' | 'Rejected' | 'Expired'
export type OfferStatus = 'Created' | 'Sent' | 'Awaiting Response' | 'Accepted' | 'Rejected' | 'Timed Out' | 'Cancelled'
export type AdminRole = 'Main Administrator' | 'Restricted Administrator'
export type AdminSection = 'deliveries' | 'partners' | 'audit-logs' | 'settings'
export type NotificationCategory =
  | 'Delivery Assigned'
  | 'Delivery Delayed'
  | 'Unassigned Delivery'
  | 'Assignment Offer Expired'
  | 'Partner Rejected Offer'
  | 'Delivery Completed'
  | 'Partner Restricted'
  | 'Partner Suspended'
  | 'Partner Support Ticket'
  | 'Document Expired'
  | 'Verification Required'
  | 'Partner Application Approved'
  | 'Partner Application Rejected'

export type AuditEventType =
  | 'Delivery created'
  | 'Delivery assigned'
  | 'Delivery reassigned'
  | 'Delivery status changed'
  | 'Delivery delayed'
  | 'Delivery cancelled'
  | 'Assignment offer created'
  | 'Assignment offer rejected'
  | 'Assignment offer timed out'
  | 'Partner created'
  | 'Partner restricted'
  | 'Partner suspended'
  | 'Partner suspension expired'
  | 'Partner availability changed'
  | 'Partner eligibility changed'
  | 'Document verification updated'
  | 'Application approved'
  | 'Application rejected'
  | 'Partner app connection updated'
  | 'Partner app data synced'
  | 'Partner app account updated'
  | 'Settings modified'
  | 'Administrator created'
  | 'Administrator access changed'
  | 'Administrator deactivated'
  | 'Administrator reactivated'
  | 'Local data reset'

export type DocumentType = 'Identity proof' | 'Driving licence' | 'Vehicle registration' | 'Profile photo'
export type ApplicationStatus = 'Submitted' | 'Approved' | 'Rejected'

export interface DeliveryMilestone {
  name: DeliveryMilestoneName
  completedAt: string | null
  completedBy: string | null
}

export interface Delivery {
  id: string
  pickup: string
  drop: string
  pickupAddress: string
  dropAddress: string
  packageSize: PackageSize
  estimatedWeightKg: number
  vehicleRequirement: VehicleType | 'Any'
  scheduledStart: string
  scheduledEnd: string
  specialInstructions: string
  createdAt: string
  status: DeliveryStatus
  statusBeforeDelay: Exclude<DeliveryStatus, 'Delayed' | 'Cancelled' | 'Completed'> | null
  delayReason: string | null
  assignmentId: string | null
  milestones: DeliveryMilestone[]
  /** Job type shown in the partner app; defaults to Grocery when absent. */
  category?: 'Grocery' | 'Restaurant'
  /** Number of items the partner carries; defaults to 1 when absent. */
  itemCount?: number
  /** Who pays for the job; defaults to Prepaid when absent. */
  paymentMode?: 'Prepaid' | 'Cash on delivery'
  /** Partner payout in ₹ chosen by the Administrator, null when not set. */
  partnerEarnings?: number | null
}

export interface VerificationHistoryEntry {
  status: DocumentStatus
  changedAt: string
  reviewer: string
  reason: string | null
}

export interface PartnerDocument {
  id: string
  partnerId: string
  type: DocumentType
  submittedAt: string | null
  status: DocumentStatus
  expiresAt: string | null
  reviewer: string | null
  rejectionReason: string | null
  history: VerificationHistoryEntry[]
  demoRecord: true
}

export interface PartnerApplication {
  id: string
  applicantName: string
  businessName: string
  maskedPhone: string
  maskedEmail: string
  vehicle: VehicleType
  serviceAreas: string[]
  submittedAt: string
  documents: DocumentType[]
  status: ApplicationStatus
  reviewedBy: string | null
  reviewedAt: string | null
  decisionReason: string | null
  partnerId: string | null
  /** Firestore document ID in delivery_app's partners collection, when linked. */
  partnerAppUid: string | null
  /** False when the application was created from a live delivery_app record. */
  demoRecord: boolean
}

export type PartnerAppMode = 'firestore' | 'endpoint'

export interface PartnerAppConfig {
  mode: PartnerAppMode
  projectId: string
  apiKey: string
  databaseId: string
  partnersCollection: string
  endpointUrl: string
  lastConnectedAt: string | null
  lastSyncAt: string | null
  lastError: string | null
}

export interface PartnerAppRecord {
  id: string
  partnerId: string | null
  name: string
  phone: string | null
  email: string | null
  vehicle: string | null
  status: string | null
  applicationStatus: string | null
  /** Partner App's explicit online/availability signal, when present. */
  isOnline?: boolean | null
  serviceAreas: string[]
  updatedAt: string | null
  fields: Record<string, string>
  syncedAt: string
}

export interface PartnerAppTicket {
  id: string
  partnerUid: string
  subject: string
  message: string
  status: string
  createdAt: string
  updatedAt: string | null
  syncedAt: string
}

export interface Partner {
  id: string
  name: string
  maskedPhone: string
  /** Synthetic number shown only for demo partner-app sign-in. */
  demoPhone: string | null
  maskedEmail: string
  registeredAt: string
  vehicle: VehicleType
  maskedRegistration: string
  serviceAreas: string[]
  availability: PartnerAvailability
  restrictedReason: string | null
  suspendedReason: string | null
  /** ISO timestamp when a timed suspension ends and eligibility is restored automatically. */
  suspendedUntil: string | null
  /** Whole-day suspension length chosen by the administrator. */
  suspensionDays: number | null
  needsOperationalReview: boolean
  /** Firestore document ID in delivery_app's partners collection, when linked. */
  partnerAppUid: string | null
}

export interface Assignment {
  id: string
  deliveryId: string
  partnerId: string
  assignedAt: string
  assignedBy: string
  status: 'Active' | 'Released' | 'Completed'
  releasedAt: string | null
  releaseReason: string | null
  attempt: number
  /** 4-digit code the customer reads out to close the delivery. */
  dropOtp: string | null
}

export interface AssignmentOffer {
  id: string
  deliveryId: string
  partnerId: string
  status: OfferStatus
  createdAt: string
  expiresAt: string
  respondedAt: string | null
  attempt: number
  note: string | null
  stateHistory: Array<{ status: OfferStatus; at: string }>
}

export interface PartnerHistoryEntry {
  id: string
  partnerId: string
  type: string
  description: string
  at: string
  actor: string
  relatedDeliveryId: string | null
}

export interface NotificationRecord {
  id: string
  category: NotificationCategory
  title: string
  message: string
  createdAt: string
  readAt: string | null
  relatedPath: string
  relatedRecordId: string
}

export interface AuditLogEntry {
  id: string
  eventType: AuditEventType
  operator: string
  operatorRole: AdminRole
  targetType: 'Delivery' | 'Partner' | 'Document' | 'Offer' | 'Application' | 'Settings' | 'Admin user' | 'Local data'
  targetId: string
  previousValue: string
  newValue: string
  timestamp: string
  reason: string
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: AdminRole
  title: string
  maskedPhone: string
  /** Console pages this account may open. Main administrators have every section. */
  sections: AdminSection[]
  /** Actions this account may perform. Main administrators have every permission. */
  permissions: Permission[]
  /** False when the signed-in Firebase or demo email has no active directory record. */
  provisioned: boolean
}

export interface AdminAccount {
  id: string
  name: string
  email: string
  role: AdminRole
  title: string
  maskedPhone: string
  sections: AdminSection[]
  permissions: Permission[]
  active: boolean
  createdAt: string
  lastSignedInAt: string | null
}

export interface OperationsSettings {
  offerTimeoutMinutes: number
  maxAssignmentAttempts: number
  delayThresholdMinutes: number
  fallbackEnabled: boolean
  fallbackBehavior: 'Next eligible partner' | 'Return to dispatch queue' | 'Notify operations manager'
  requireVerifiedDocuments: boolean
  requireAvailability: boolean
  requireServiceAreaMatch: boolean
  enforceVehicleCompatibility: boolean
  requiredDocuments: DocumentType[]
  notifications: Record<NotificationCategory, boolean>
}

export interface OperationsState {
  schemaVersion: 3
  deliveries: Delivery[]
  partners: Partner[]
  applications: PartnerApplication[]
  partnerApp: PartnerAppConfig
  partnerAppRecords: PartnerAppRecord[]
  partnerAppTickets: PartnerAppTicket[]
  documents: PartnerDocument[]
  assignments: Assignment[]
  offers: AssignmentOffer[]
  partnerHistory: PartnerHistoryEntry[]
  notifications: NotificationRecord[]
  auditLogs: AuditLogEntry[]
  admins: AdminAccount[]
  user: AdminUser
  settings: OperationsSettings
}

export type Permission = 'read' | 'assignment' | 'delivery-management' | 'partner-management' | 'document-review' | 'application-review' | 'settings' | 'admin'

export interface Feedback {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

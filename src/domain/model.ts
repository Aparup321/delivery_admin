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
export type AdminRole = 'Admin' | 'Operations Manager' | 'Operations Staff' | 'Viewer'
export type NotificationCategory =
  | 'Delivery Assigned'
  | 'Delivery Delayed'
  | 'Unassigned Delivery'
  | 'Assignment Offer Expired'
  | 'Partner Rejected Offer'
  | 'Delivery Completed'
  | 'Partner Restricted'
  | 'Partner Suspended'
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
  | 'Partner restricted'
  | 'Partner suspended'
  | 'Partner availability changed'
  | 'Partner eligibility changed'
  | 'Document verification updated'
  | 'Application approved'
  | 'Application rejected'
  | 'Partner app connection updated'
  | 'Partner app data synced'
  | 'Settings modified'
  | 'Administrative role changed'
  | 'Demo data reset'

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
  demoRecord: true
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
  serviceAreas: string[]
  updatedAt: string | null
  fields: Record<string, string>
  syncedAt: string
}

export interface Partner {
  id: string
  name: string
  maskedPhone: string
  maskedEmail: string
  registeredAt: string
  vehicle: VehicleType
  maskedRegistration: string
  serviceAreas: string[]
  availability: PartnerAvailability
  restrictedReason: string | null
  suspendedReason: string | null
  needsOperationalReview: boolean
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
  targetType: 'Delivery' | 'Partner' | 'Document' | 'Offer' | 'Application' | 'Settings' | 'Admin user' | 'Demo data'
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
  documents: PartnerDocument[]
  assignments: Assignment[]
  offers: AssignmentOffer[]
  partnerHistory: PartnerHistoryEntry[]
  notifications: NotificationRecord[]
  auditLogs: AuditLogEntry[]
  user: AdminUser
  settings: OperationsSettings
}

export type Permission = 'read' | 'assignment' | 'delivery-management' | 'partner-management' | 'document-review' | 'application-review' | 'settings' | 'admin'

export interface Feedback {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

import { createDefaultAdmin, createDemoAdminDirectory } from './admin.ts'
import { applyFirebaseConnectionDefaults } from '../config/firebase.ts'
import { DELIVERY_MILESTONES, type Assignment, type AuditLogEntry, type Delivery, type DeliveryMilestone, type DocumentType, type OperationsSettings, type OperationsState, type Partner, type PartnerAppConfig, type PartnerApplication, type PartnerDocument, type PartnerHistoryEntry } from './model.ts'

const requiredDocuments: DocumentType[] = ['Identity proof', 'Driving licence', 'Vehicle registration']

function isoFrom(now: number, offsetMinutes: number) {
  return new Date(now + offsetMinutes * 60_000).toISOString()
}

function makeMilestones(completedCount: number, now: number, baseOffset: number): DeliveryMilestone[] {
  return DELIVERY_MILESTONES.map((name, index) => ({
    name,
    completedAt: index < completedCount ? isoFrom(now, baseOffset + index * 9) : null,
    completedBy: index < completedCount ? (index === 0 ? 'Partner accepted' : 'Delivery partner') : null,
  }))
}

const partnerSeedRows: Array<Omit<Partner, 'maskedPhone' | 'demoPhone' | 'maskedEmail' | 'registeredAt' | 'maskedRegistration' | 'restrictedReason' | 'suspendedReason' | 'suspendedUntil' | 'suspensionDays' | 'needsOperationalReview' | 'partnerAppUid'>> = [
  { id: 'DP-0192', name: 'Anirban G.', vehicle: 'Bike', serviceAreas: ['Barasat', 'New Town', 'Rajarhat'], availability: 'On Delivery' },
  { id: 'DP-0189', name: 'Mohit S.', vehicle: 'Scooter', serviceAreas: ['Dum Dum', 'Salt Lake', 'Kolkata'], availability: 'On Delivery' },
  { id: 'DP-0178', name: 'Rakesh P.', vehicle: 'Van', serviceAreas: ['Lake Town', 'Sector V', 'Salt Lake'], availability: 'On Delivery' },
  { id: 'DP-0195', name: 'Subhajit D.', vehicle: 'Bike', serviceAreas: ['Kolkata', 'Dum Dum', 'Barasat'], availability: 'On Delivery' },
  { id: 'DP-0187', name: 'Sayan M.', vehicle: 'Scooter', serviceAreas: ['New Town', 'Bidhannagar', 'Rajarhat'], availability: 'Available' },
  { id: 'DP-0181', name: 'Priya R.', vehicle: 'Scooter', serviceAreas: ['Rajarhat', 'New Town', 'Bidhannagar'], availability: 'On Delivery' },
  { id: 'DP-0174', name: 'Arjun B.', vehicle: 'Bike', serviceAreas: ['Lake Town', 'Dum Dum'], availability: 'Offline' },
  { id: 'DP-0168', name: 'Ishita K.', vehicle: 'Scooter', serviceAreas: ['Bidhannagar', 'Sector V', 'New Town'], availability: 'Available' },
  { id: 'DP-0182', name: 'Nikhil M.', vehicle: 'Bike', serviceAreas: ['New Town', 'Rajarhat', 'Salt Lake'], availability: 'Available' },
  { id: 'DP-0171', name: 'Ritika D.', vehicle: 'Scooter', serviceAreas: ['Dum Dum', 'Barasat', 'Kolkata'], availability: 'Available' },
  { id: 'DP-0169', name: 'Ayan P.', vehicle: 'Bike', serviceAreas: ['Kolkata', 'Bidhannagar'], availability: 'Available' },
]

function demoPhoneFor(index: number) {
  return `+91 90000 0${String(4100 + index * 137).slice(-4)}`
}

export const DEMO_PARTNER_PHONES: Record<string, string> = Object.fromEntries(
  partnerSeedRows.map((partner, index) => [partner.id, demoPhoneFor(index)]),
)

function makePartners(now: number): Partner[] {
  return partnerSeedRows.map((partner, index) => ({
    ...partner,
    maskedPhone: `+91 ••••• ${String(4100 + index * 137).slice(-4)}`,
    demoPhone: demoPhoneFor(index),
    maskedEmail: `${partner.name.split(' ')[0].toLowerCase()}••@picdrop.in`,
    registeredAt: isoFrom(now, -(90 + index * 23) * 24 * 60),
    maskedRegistration: `WB-••-${String(2100 + index * 79).slice(-4)}`,
    restrictedReason: null,
    suspendedReason: null,
    suspendedUntil: null,
    suspensionDays: null,
    needsOperationalReview: false,
    partnerAppUid: null,
  }))
}

function makeDocuments(partners: Partner[], now: number): PartnerDocument[] {
  const allTypes: DocumentType[] = [...requiredDocuments, 'Profile photo']
  return partners.flatMap((partner, partnerIndex) => allTypes.map((type, typeIndex) => {
    const isMissing = partner.id === 'DP-0174' && type === 'Vehicle registration'
    const isExpired = partner.id === 'DP-0168' && type === 'Driving licence'
    const isReview = partner.id === 'DP-0169' && type === 'Identity proof'
    const status = isMissing ? 'Missing' : isExpired ? 'Expired' : isReview ? 'Under Review' : 'Verified'
    const expiry = isExpired ? isoFrom(now, -24 * 60 * 60) : isoFrom(now, (150 + partnerIndex * 20 + typeIndex * 13) * 24 * 60)
    const reviewer = status === 'Verified' || status === 'Expired' ? 'Ops reviewer' : null
    return {
      id: `DOC-${partner.id.slice(-4)}-${typeIndex + 1}`,
      partnerId: partner.id,
      type,
      submittedAt: isMissing ? null : isoFrom(now, -(15 + partnerIndex * 6) * 24 * 60),
      status,
      expiresAt: type === 'Profile photo' || isMissing ? null : expiry,
      reviewer,
      rejectionReason: null,
      history: status === 'Missing' ? [] : [{ status, changedAt: isoFrom(now, -(12 + partnerIndex) * 24 * 60), reviewer: reviewer ?? 'Review queue', reason: null }],
      demoRecord: true as const,
    }
  }))
}

function makeApplications(now: number): PartnerApplication[] {
  return [
    {
      id: 'APP-2041', applicantName: 'Rohan Mitra', businessName: 'Mitra Express Rides',
      maskedPhone: '+91 ••••• 4188', maskedEmail: 'rohan••@onboarding.picdrop.in',
      vehicle: 'Scooter', serviceAreas: ['New Town', 'Rajarhat'], submittedAt: isoFrom(now, -125),
      documents: ['Identity proof', 'Driving licence', 'Vehicle registration'],
      status: 'Submitted', reviewedBy: null, reviewedAt: null, decisionReason: null, partnerId: null, partnerAppUid: null, demoRecord: true,
    },
    {
      id: 'APP-2040', applicantName: 'Farhan Qureshi', businessName: 'Salt Lake Scoot Couriers',
      maskedPhone: '+91 ••••• 5402', maskedEmail: 'farhan••@onboarding.picdrop.in',
      vehicle: 'Scooter', serviceAreas: ['Salt Lake', 'Bidhannagar'], submittedAt: isoFrom(now, -305),
      documents: ['Identity proof', 'Driving licence'],
      status: 'Submitted', reviewedBy: null, reviewedAt: null, decisionReason: null, partnerId: null, partnerAppUid: null, demoRecord: true,
    },
    {
      id: 'APP-2039', applicantName: 'Sneha Banerjee', businessName: 'Bidhan Bikes',
      maskedPhone: '+91 ••••• 6673', maskedEmail: 'sneha••@onboarding.picdrop.in',
      vehicle: 'Bike', serviceAreas: ['Bidhannagar', 'Sector V'], submittedAt: isoFrom(now, -1_690),
      documents: ['Identity proof', 'Driving licence', 'Vehicle registration'],
      status: 'Submitted', reviewedBy: null, reviewedAt: null, decisionReason: null, partnerId: null, partnerAppUid: null, demoRecord: true,
    },
    {
      id: 'APP-2038', applicantName: 'Subhajit D.', businessName: 'Subhajit Bike Desk',
      maskedPhone: '+91 ••••• 7921', maskedEmail: 'subhajit••@onboarding.picdrop.in',
      vehicle: 'Bike', serviceAreas: ['Kolkata', 'Dum Dum', 'Barasat'], submittedAt: isoFrom(now, -4_320),
      documents: ['Identity proof', 'Driving licence', 'Vehicle registration'],
      status: 'Approved', reviewedBy: 'Operations Admin', reviewedAt: isoFrom(now, -4_080),
      decisionReason: 'Documents complete for the onboarding check.', partnerId: 'DP-0195', partnerAppUid: null, demoRecord: true,
    },
    {
      id: 'APP-2037', applicantName: 'Tanushree Ghosh', businessName: 'QuickDrop Kolkata',
      maskedPhone: '+91 ••••• 8340', maskedEmail: 'tanushree••@onboarding.picdrop.in',
      vehicle: 'Bike', serviceAreas: ['Kolkata'], submittedAt: isoFrom(now, -7_300),
      documents: ['Identity proof'],
      status: 'Rejected', reviewedBy: 'Operations Admin', reviewedAt: isoFrom(now, -7_000),
      decisionReason: 'Vehicle registration was not submitted with the application.', partnerId: null, partnerAppUid: null, demoRecord: true,
    },
    {
      id: 'APP-2036', applicantName: 'Victor Das', businessName: 'Metro Moving Vans',
      maskedPhone: '+91 ••••• 9034', maskedEmail: 'victor••@onboarding.picdrop.in',
      vehicle: 'Van', serviceAreas: ['Sector V', 'Salt Lake'], submittedAt: isoFrom(now, -9_200),
      documents: ['Identity proof', 'Driving licence', 'Vehicle registration'],
      status: 'Submitted', reviewedBy: null, reviewedAt: null, decisionReason: null, partnerId: null, partnerAppUid: null, demoRecord: true,
    },
  ]
}

function makePartnerHistory(now: number): PartnerHistoryEntry[] {
  return [
    { id: 'PH-SEED-1', partnerId: 'DP-0187', type: 'Document verification', description: 'Driving licence verified after review.', at: isoFrom(now, -52), actor: 'Operations Admin', relatedDeliveryId: null },
    { id: 'PH-SEED-2', partnerId: 'DP-0168', type: 'Document verification', description: 'Driving licence changed from Verified to Expired after its listed expiry date.', at: isoFrom(now, -96), actor: 'Operations Admin', relatedDeliveryId: null },
    { id: 'PH-SEED-3', partnerId: 'DP-0174', type: 'Document verification', description: 'Vehicle registration recorded as missing; no submission on record.', at: isoFrom(now, -140), actor: 'Operations Admin', relatedDeliveryId: null },
    { id: 'PH-SEED-4', partnerId: 'DP-0192', type: 'Availability changed', description: 'Availability changed from Offline to Available for the dispatch queue.', at: isoFrom(now, -210), actor: 'Operations Admin', relatedDeliveryId: null },
    { id: 'PH-SEED-5', partnerId: 'DP-0189', type: 'Availability changed', description: 'Availability changed from Offline to Available for the dispatch queue.', at: isoFrom(now, -260), actor: 'Operations Admin', relatedDeliveryId: null },
    { id: 'PH-SEED-6', partnerId: 'DP-0195', type: 'Application approved', description: 'Onboarding application APP-2038 approved; documents queued for KYC review.', at: isoFrom(now, -4_080), actor: 'Operations Admin', relatedDeliveryId: null },
  ]
}

function makeDelivery(now: number, values: {
  id: string; pickup: string; drop: string; packageSize: Delivery['packageSize']; weight: number;
  status: Delivery['status']; partnerId: string | null; scheduledOffset: number; endOffset: number;
  completedMilestones: number; createdOffset: number; delayReason?: string;
}) : Delivery {
  const partnerRequirement = values.packageSize === 'Large' || values.packageSize === 'Extra large' ? 'Van' : 'Any'
  const statusBeforeDelay = values.status === 'Delayed' ? (values.completedMilestones >= 4 ? 'In Transit' : 'Assigned') : null
  return {
    id: values.id,
    pickup: values.pickup,
    drop: values.drop,
    pickupAddress: `Pickup point · ${values.pickup}`,
    dropAddress: `Drop point · ${values.drop}`,
    packageSize: values.packageSize,
    estimatedWeightKg: values.weight,
    vehicleRequirement: partnerRequirement,
    scheduledStart: isoFrom(now, values.scheduledOffset),
    scheduledEnd: isoFrom(now, values.endOffset),
    specialInstructions: values.id === 'DLV-1048' ? 'Handle with care · Illustrative instruction' : 'No special instructions',
    createdAt: isoFrom(now, values.createdOffset),
    status: values.status,
    statusBeforeDelay,
    delayReason: values.delayReason ?? null,
    assignmentId: values.partnerId ? `ASN-${values.id.slice(-4)}` : null,
    milestones: makeMilestones(values.completedMilestones, now, values.createdOffset + 12),
  }
}

export const DEFAULT_PARTNER_APP_CONFIG: PartnerAppConfig = applyFirebaseConnectionDefaults({
  mode: 'firestore',
  projectId: '',
  apiKey: '',
  databaseId: '(default)',
  partnersCollection: 'partners',
  endpointUrl: '',
  lastConnectedAt: null,
  lastSyncAt: null,
  lastError: null,
})

export const DEFAULT_SETTINGS: OperationsSettings = {
  offerTimeoutMinutes: 5,
  maxAssignmentAttempts: 3,
  delayThresholdMinutes: 15,
  fallbackEnabled: false,
  fallbackBehavior: 'Next eligible partner',
  requireVerifiedDocuments: true,
  requireAvailability: true,
  requireServiceAreaMatch: true,
  enforceVehicleCompatibility: true,
  requiredDocuments,
  notifications: {
    'Delivery Assigned': true,
    'Delivery Delayed': true,
    'Unassigned Delivery': true,
    'Assignment Offer Expired': true,
    'Partner Rejected Offer': true,
    'Delivery Completed': true,
    'Partner Restricted': true,
    'Partner Suspended': true,
    'Document Expired': true,
    'Verification Required': true,
    'Partner Application Approved': true,
    'Partner Application Rejected': true,
  },
}

export function createDemoState(timestamp = Date.now()): OperationsState {
  const now = timestamp
  const partners = makePartners(now)
  const deliveries = [
    makeDelivery(now, { id: 'DLV-1048', pickup: 'Barasat', drop: 'New Town', packageSize: 'Small', weight: 2.1, status: 'In Transit', partnerId: 'DP-0192', scheduledOffset: -24, endOffset: 65, completedMilestones: 4, createdOffset: -85 }),
    makeDelivery(now, { id: 'DLV-1047', pickup: 'Dum Dum', drop: 'Salt Lake', packageSize: 'Medium', weight: 4.4, status: 'Assigned', partnerId: 'DP-0189', scheduledOffset: 18, endOffset: 118, completedMilestones: 1, createdOffset: -54 }),
    makeDelivery(now, { id: 'DLV-1046', pickup: 'Kolkata', drop: 'Rajarhat', packageSize: 'Small', weight: 1.6, status: 'Unassigned', partnerId: null, scheduledOffset: 34, endOffset: 154, completedMilestones: 0, createdOffset: -24 }),
    makeDelivery(now, { id: 'DLV-1045', pickup: 'Lake Town', drop: 'Sector V', packageSize: 'Large', weight: 9.8, status: 'Delayed', partnerId: 'DP-0178', scheduledOffset: -143, endOffset: -23, completedMilestones: 4, createdOffset: -214, delayReason: 'Handoff review pending' }),
    makeDelivery(now, { id: 'DLV-1044', pickup: 'New Town', drop: 'Bidhannagar', packageSize: 'Small', weight: 1.2, status: 'Completed', partnerId: 'DP-0187', scheduledOffset: -340, endOffset: -220, completedMilestones: 6, createdOffset: -420 }),
    makeDelivery(now, { id: 'DLV-1043', pickup: 'Barasat', drop: 'Dum Dum', packageSize: 'Medium', weight: 3.9, status: 'In Transit', partnerId: 'DP-0195', scheduledOffset: -15, endOffset: 95, completedMilestones: 3, createdOffset: -110 }),
    makeDelivery(now, { id: 'DLV-1042', pickup: 'Salt Lake', drop: 'New Town', packageSize: 'Small', weight: 1.7, status: 'Completed', partnerId: 'DP-0181', scheduledOffset: -510, endOffset: -390, completedMilestones: 6, createdOffset: -580 }),
    makeDelivery(now, { id: 'DLV-1041', pickup: 'Rajarhat', drop: 'Kolkata', packageSize: 'Large', weight: 12.2, status: 'Unassigned', partnerId: null, scheduledOffset: 82, endOffset: 202, completedMilestones: 0, createdOffset: -10 }),
    makeDelivery(now, { id: 'DLV-1040', pickup: 'Bidhannagar', drop: 'Sector V', packageSize: 'Medium', weight: 3.4, status: 'Assigned', partnerId: 'DP-0181', scheduledOffset: 45, endOffset: 165, completedMilestones: 1, createdOffset: -8 }),
    makeDelivery(now, { id: 'DLV-1039', pickup: 'New Town', drop: 'Salt Lake', packageSize: 'Small', weight: 2.4, status: 'Pending', partnerId: null, scheduledOffset: 120, endOffset: 240, completedMilestones: 0, createdOffset: -5 }),
  ]

  // The seeded active assignments are normalized onto distinct partners.
  const deliveryForPartner: Record<string, string> = {
    'DLV-1048': 'DP-0192', 'DLV-1047': 'DP-0189', 'DLV-1045': 'DP-0178',
    'DLV-1044': 'DP-0187', 'DLV-1043': 'DP-0195', 'DLV-1042': 'DP-0169', 'DLV-1040': 'DP-0181',
  }
  const normalizedDeliveries = deliveries.map((delivery) => {
    const partnerId = deliveryForPartner[delivery.id]
    if (!partnerId) return delivery
    return { ...delivery, assignmentId: `ASN-${delivery.id.slice(-4)}` }
  })
  const activePartnerIds = new Set(Object.entries(deliveryForPartner)
    .filter(([deliveryId]) => !['DLV-1044', 'DLV-1042'].includes(deliveryId))
    .map(([, partnerId]) => partnerId))
  const normalizedPartners = partners.map((partner) => ({
    ...partner,
    availability: activePartnerIds.has(partner.id) ? 'On Delivery' as const : partner.availability,
  }))
  const documents = makeDocuments(normalizedPartners, now)
  const assignments: Assignment[] = Object.entries(deliveryForPartner).map(([deliveryId, partnerId], index) => ({
    id: `ASN-${deliveryId.slice(-4)}`,
    deliveryId,
    partnerId,
    assignedAt: isoFrom(now, -80 + index * 11),
    assignedBy: 'Operations Admin',
    status: deliveryId === 'DLV-1044' || deliveryId === 'DLV-1042' ? 'Completed' : 'Active',
    releasedAt: null,
    releaseReason: null,
    attempt: 1,
  }))
  const logs: AuditLogEntry[] = assignments.map((assignment, index) => ({
    id: `EVT-SEED-${index + 1}`,
    eventType: 'Delivery assigned',
    operator: assignment.assignedBy,
    operatorRole: 'Main Administrator',
    targetType: 'Delivery',
    targetId: assignment.deliveryId,
    previousValue: 'Unassigned',
    newValue: assignment.partnerId,
    timestamp: assignment.assignedAt,
    reason: 'Initial linked record',
  }))
  const notifications = [
    { id: 'NTF-SEED-1', category: 'Delivery Delayed' as const, title: 'Delivery delayed', message: 'DLV-1045 is delayed and requires an operations review.', createdAt: isoFrom(now, -22), readAt: null, relatedPath: '/admin/deliveries/DLV-1045', relatedRecordId: 'DLV-1045' },
    { id: 'NTF-SEED-2', category: 'Unassigned Delivery' as const, title: 'Delivery is unassigned', message: 'DLV-1046 is awaiting an eligible delivery partner.', createdAt: isoFrom(now, -19), readAt: null, relatedPath: '/admin/deliveries/DLV-1046/assign', relatedRecordId: 'DLV-1046' },
    { id: 'NTF-SEED-3', category: 'Document Expired' as const, title: 'Document expired', message: 'DP-0168 has an expired driving licence in the illustrative records.', createdAt: isoFrom(now, -14), readAt: null, relatedPath: '/admin/partners/DP-0168', relatedRecordId: 'DP-0168' },
    { id: 'NTF-SEED-4', category: 'Verification Required' as const, title: 'Verification needs review', message: 'DP-0174 is missing a mandatory vehicle registration record.', createdAt: isoFrom(now, -10), readAt: isoFrom(now, -8), relatedPath: '/admin/partners/DP-0174', relatedRecordId: 'DP-0174' },
  ]

  return {
    schemaVersion: 3,
    deliveries: normalizedDeliveries,
    partners: normalizedPartners,
    applications: makeApplications(now),
    partnerApp: structuredClone(DEFAULT_PARTNER_APP_CONFIG),
    partnerAppRecords: [],
    documents,
    assignments,
    offers: [],
    partnerHistory: makePartnerHistory(now),
    notifications,
    auditLogs: logs,
    admins: createDemoAdminDirectory(),
    user: createDefaultAdmin(),
    settings: structuredClone(DEFAULT_SETTINGS),
  }
}

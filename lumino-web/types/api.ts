import type { MapProperty, OrganizationFeatureAccess, PropertyDetail } from "@/types/entities";
import type { OrganizationBillingPlan, OrganizationFeatureOverrides } from "@/lib/platform/features";

export interface MapPropertiesResponse {
  items: MapProperty[];
  features: OrganizationFeatureAccess;
}

export interface VisitResponse {
  visitId: string;
  propertyId: string;
}

export interface PropertyDetailResponse {
  item: PropertyDetail;
}

export interface PlatformOrganizationChecklist {
  firstAdminInvited: boolean;
  brandingConfigured: boolean;
  firstImportCompleted: boolean;
  firstTerritoryCreated: boolean;
}

export interface PlatformOrganizationDatasetEntitlements {
  sold_properties: {
    cities: string[];
    zips: string[];
  };
  solar_permits: {
    cities: string[];
    zips: string[];
  };
  roofing_permits: {
    cities: string[];
    zips: string[];
  };
}

export interface PlatformOrganizationOverviewItem {
  organizationId: string;
  name: string;
  appName: string;
  slug: string | null;
  status: string;
  billingPlan: OrganizationBillingPlan;
  isPlatformSource: boolean;
  createdAt: string;
  teamMemberCount: number;
  activeTeamMemberCount: number;
  adminCount: number;
  importBatchCount: number;
  completedImportCount: number;
  territoryCount: number;
  lastImportAt: string | null;
  lastSecurityEventAt: string | null;
  lastActivityAt: string;
  featureOverrides: OrganizationFeatureOverrides;
  effectiveFeatures: OrganizationFeatureAccess;
  datasetEntitlements: PlatformOrganizationDatasetEntitlements;
  checklist: PlatformOrganizationChecklist;
}

export interface PlatformOverviewResponse {
  items: PlatformOrganizationOverviewItem[];
}

export interface PlatformSecurityEventItem {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  targetUserId: string | null;
  targetName: string | null;
  targetEmail: string | null;
  eventType: string;
  severity: "info" | "low" | "medium" | "high";
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformSecurityEventsResponse {
  items: PlatformSecurityEventItem[];
}

export interface ResolvePropertyResponse {
  propertyId: string | null;
  created: boolean;
  preview?: {
    address: string;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    lat: number;
    lng: number;
  } | null;
}

export interface RepQueueItem {
  leadId: string;
  propertyId: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  leadStatus: string | null;
  lastVisitOutcome: string | null;
  lastVisitedAt: string | null;
  nextFollowUpAt: string | null;
  appointmentAt: string | null;
  visitCount: number;
  notHomeCount: number;
  priority: "due_now" | "revisit" | "appointment" | "opportunity" | "needs_attention";
}

export interface RepQueueResponse {
  summary: {
    dueNow: number;
    revisits: number;
    appointments: number;
    opportunities: number;
    needsAttention: number;
  };
  dueNow: RepQueueItem[];
  revisits: RepQueueItem[];
  appointments: RepQueueItem[];
  opportunities: RepQueueItem[];
  needsAttention: RepQueueItem[];
}

export interface RouteRunStopItem {
  routeRunStopId: string;
  leadId: string | null;
  propertyId: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  sequenceNumber: number;
  stopStatus: "pending" | "completed" | "skipped" | "failed";
  disposition: string | null;
  skippedReason: string | null;
  notes: string | null;
  homeownerName: string | null;
  phone: string | null;
  email: string | null;
  leadStatus: string | null;
  appointmentAt: string | null;
}

export interface ActiveRouteRunResponse {
  routeRunId: string;
  status: "active" | "paused" | "completed" | "cancelled";
  optimizationMode: "drive_time" | "mileage";
  startedAt: string;
  startedFromLat: number | null;
  startedFromLng: number | null;
  startedFromLabel: string | null;
  totalStops: number;
  completedStops: number;
  pendingStops: number;
  skippedStops: number;
  nextStop: RouteRunStopItem | null;
  stops: RouteRunStopItem[];
  nextStopDirectionsUrl: string | null;
}

export interface CreateRouteRunResponse {
  routeRunId: string;
  totalStops: number;
  firstPropertyId: string | null;
}

export interface ManagerKpiSummary {
  activeReps: number;
  knocksToday: number;
  opportunitiesToday: number;
  appointmentsToday: number;
  overdueFollowUps: number;
}

export interface ManagerRepScorecard {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  knocks: number;
  notHome: number;
  doorhangers: number;
  opportunities: number;
  appointments: number;
  overdueFollowUps: number;
  opportunityRate: number;
  activeWindowMinutes: number;
}

export interface ManagerRecentActivityItem {
  id: string;
  type: "visit" | "lead";
  address: string;
  outcome: string | null;
  leadStatus: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface ManagerLeakageItem {
  leadId: string;
  propertyId: string | null;
  address: string;
  leadStatus: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  leakageReason: "overdue_follow_up" | "stale_opportunity";
}

export interface ManagerDashboardResponse {
  summary: ManagerKpiSummary;
  alerts: ManagerAlertItem[];
  coachingFlags: ManagerCoachingFlag[];
  repScorecards: ManagerRepScorecard[];
  recentActivity: ManagerRecentActivityItem[];
  neighborhoods: ManagerNeighborhoodPerformanceItem[];
  neighborhoodTrends: ManagerNeighborhoodTrendItem[];
  repPresence: ManagerRepPresenceItem[];
  supervisionMap: ManagerMapPoint[];
  territories: ManagerTerritorySummaryItem[];
  leakage: {
    overdueCount: number;
    staleOpportunityCount: number;
    items: ManagerLeakageItem[];
  };
}

export interface ManagerNeighborhoodPerformanceItem {
  city: string | null;
  state: string | null;
  knocks: number;
  opportunities: number;
  appointments: number;
  notHome: number;
  opportunityRate: number;
}

export interface ManagerTerritorySummaryItem {
  territoryId: string;
  name: string;
  status: string;
  propertyCount: number;
  knocksToday: number;
  opportunitiesToday: number;
  appointmentsToday: number;
  health: "strong" | "mixed" | "cold";
}

export interface ManagerNeighborhoodTrendItem {
  city: string | null;
  state: string | null;
  todayKnocks: number;
  todayOpportunities: number;
  trailingAvgKnocks: number;
  trailingAvgOpportunities: number;
}

export interface ManagerRepPresenceItem {
  userId: string;
  fullName: string | null;
  lastSeenAt: string | null;
  lastOutcome: string | null;
  lat: number | null;
  lng: number | null;
}

export interface ManagerMapPoint {
  id: string;
  propertyId: string;
  address: string;
  lat: number;
  lng: number;
  outcome: string | null;
  actorName: string | null;
  capturedAt: string;
}

export interface ManagerAlertItem {
  id: string;
  title: string;
  body: string;
  severity: "high" | "medium" | "low";
  href: string | null;
}

export interface ManagerCoachingFlag {
  id: string;
  userId: string;
  repName: string | null;
  reason: string;
  detail: string;
  severity: "high" | "medium" | "low";
  href: string;
}

export type PerformanceCompetitionMetric = "knocks" | "opportunities" | "appointments" | "doorhangers";
export type PerformanceCompetitionStatus = "scheduled" | "active" | "completed" | "cancelled";

export interface PerformanceLeaderboardEntry {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  rank: number;
  metricValue: number;
  knocks: number;
  opportunities: number;
  appointments: number;
  doorhangers: number;
  isCurrentUser: boolean;
}

export interface PerformanceCompetitionItem {
  id: string;
  title: string;
  description: string | null;
  metric: PerformanceCompetitionMetric;
  periodType: "day" | "week" | "custom";
  startAt: string;
  endAt: string;
  status: PerformanceCompetitionStatus;
  leaders: PerformanceLeaderboardEntry[];
  myStanding: PerformanceLeaderboardEntry | null;
}

export interface PerformanceBadgeItem {
  id: string;
  label: string;
  detail: string;
  tone: "gold" | "silver" | "bronze" | "emerald" | "electric";
}

export interface PerformanceHubResponse {
  canManageCompetitions: boolean;
  dailyLeaderboard: PerformanceLeaderboardEntry[];
  weeklyLeaderboard: PerformanceLeaderboardEntry[];
  activeCompetitions: PerformanceCompetitionItem[];
  upcomingCompetitions: PerformanceCompetitionItem[];
  completedCompetitions: PerformanceCompetitionItem[];
  badges: PerformanceBadgeItem[];
  mySummary: {
    dailyRank: number | null;
    weeklyRank: number | null;
    dailyKnocks: number;
    weeklyAppointments: number;
    activeCompetitionCount: number;
  };
}

export interface TerritoryListItem {
  territoryId: string;
  name: string;
  status: string;
  propertyCount: number;
  createdAt: string;
}

export interface TerritoryPropertyItem {
  propertyId: string;
  address: string;
  city: string | null;
  state: string | null;
}

export interface TerritoryDetailResponse {
  item: {
    territoryId: string;
    name: string;
    status: string;
    propertyCount: number;
    properties: TerritoryPropertyItem[];
  };
}

export interface TerritoriesResponse {
  items: TerritoryListItem[];
}

export interface TerritoryPropertySearchResponse {
  items: TerritoryPropertyItem[];
}

export interface ManagerDailySummaryResponse {
  generatedAt: string;
  dateLabel: string;
  headline: string;
  summary: {
    activeReps: number;
    knocksToday: number;
    opportunitiesToday: number;
    appointmentsToday: number;
    overdueFollowUps: number;
    staleOpportunities: number;
  };
  highlights: string[];
  risks: string[];
  territoryNotes: string;
  emailSubject: string;
  emailBody: string;
}

export interface AppointmentScheduleItem {
  leadId: string;
  propertyId: string;
  address: string;
  city: string | null;
  state: string | null;
  scheduledAt: string;
  leadStatus: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  ownerId: string | null;
  ownerName: string | null;
  reminderTaskId: string | null;
  reminderDueAt: string | null;
  appointmentRecordId: string | null;
  appointmentStatus: "scheduled" | "confirmed" | "completed" | "no_show" | "cancelled" | "rescheduled";
}

export interface AppointmentsResponse {
  summary: {
    pastDue: number;
    today: number;
    upcoming: number;
  };
  pastDue: AppointmentScheduleItem[];
  today: AppointmentScheduleItem[];
  upcoming: AppointmentScheduleItem[];
}

export interface GoogleCalendarConnectionStatus {
  configured: boolean;
  connected: boolean;
  calendarEmail: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export interface GoogleCalendarConnectionStatusResponse {
  item: GoogleCalendarConnectionStatus;
}

export interface GoogleCalendarConnectResponse {
  authUrl: string;
}

export interface GoogleCalendarConflictCheckResponse {
  connected: boolean;
  hasConflict: boolean;
  busy: Array<{
    start: string;
    end: string;
  }>;
}

export interface SearchResultItem {
  id: string;
  kind: "property" | "lead";
  title: string;
  subtitle: string;
  href: string;
  propertyId: string | null;
  leadId: string | null;
}

export interface SearchResponse {
  items: SearchResultItem[];
}

export interface TaskBoardItem {
  id: string;
  kind: "follow_up" | "appointment" | "manual" | "needs_attention";
  title: string;
  address: string;
  city: string | null;
  state: string | null;
  dueAt: string | null;
  leadStatus: string | null;
  propertyId: string | null;
  leadId: string | null;
  notes: string | null;
}

export interface TasksResponse {
  summary: {
    overdue: number;
    today: number;
    upcoming: number;
    needsAttention: number;
  };
  overdue: TaskBoardItem[];
  today: TaskBoardItem[];
  upcoming: TaskBoardItem[];
  needsAttention: TaskBoardItem[];
}

export interface TaskMutationResponse {
  taskId: string;
}

export interface LeadListItem {
  leadId: string;
  propertyId: string | null;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  leadStatus: string;
  nextFollowUpAt: string | null;
  appointmentAt: string | null;
  lastActivityAt: string | null;
  lastActivityOutcome: string | null;
  ownerName: string | null;
  ownerId: string | null;
}

export interface LeadsResponse {
  items: LeadListItem[];
}

export interface LeadDetailActivityItem {
  id: string;
  type: string;
  createdAt: string;
  actorUserId: string | null;
  data: Record<string, unknown>;
}

export interface LeadDetailItem {
  leadId: string;
  propertyId: string | null;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  contactName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  leadStatus: string;
  interestLevel: string | null;
  decisionMakerStatus: string | null;
  preferredChannel: string | null;
  bestContactTime: string | null;
  textConsent: boolean | null;
  objectionType: string | null;
  billReceived: boolean | null;
  proposalPresented: boolean | null;
  appointmentOutcome: string | null;
  rescheduleReason: string | null;
  cancellationReason: string | null;
  engagementScore: number | null;
  cadenceTrack: string | null;
  nextFollowUpAt: string | null;
  appointmentAt: string | null;
  lastActivityAt: string | null;
  lastActivityType: string | null;
  lastActivityOutcome: string | null;
  notes: string | null;
  ownerName: string | null;
  propertySummary: {
    lastVisitOutcome: string | null;
    lastVisitedAt: string | null;
    visitCount: number;
  } | null;
  activities: LeadDetailActivityItem[];
}

export interface LeadDetailResponse {
  item: LeadDetailItem;
}

export interface TeamMemberItem {
  memberId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
  onboardingStatus: "active" | "pending" | "inactive";
  invitedAt: string | null;
  lastSignInAt: string | null;
  joinedAt: string | null;
}

export interface TeamMembersResponse {
  items: TeamMemberItem[];
  issues: TeamCleanupIssue[];
}

export interface TeamMemberActionResponse {
  ok: true;
}

export interface TeamCleanupIssue {
  id: string;
  type:
    | "member_missing_auth"
    | "member_auth_missing"
    | "membership_missing_user"
    | "orphan_app_user"
    | "duplicate_email";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  email: string | null;
  userId: string | null;
  memberId: string | null;
  cleanupAction: "delete_orphan_app_user" | null;
}

export interface OrganizationBranding {
  organizationId: string;
  appName: string;
  logoUrl: string | null;
  logoScale: number | null;
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  backgroundAccentColor: string | null;
  surfaceColor: string | null;
  sidebarColor: string | null;
}

export interface OrganizationBrandingResponse {
  item: OrganizationBranding;
}

export interface AppBranding {
  brandingId: string;
  appName: string;
  logoUrl: string | null;
  logoScale: number | null;
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  backgroundAccentColor: string | null;
  surfaceColor: string | null;
  sidebarColor: string | null;
}

export interface AppBrandingResponse {
  item: AppBranding;
}

export interface OrganizationListItem {
  organizationId: string;
  name: string;
  slug: string | null;
  status: string;
  billingPlan: string;
  appName: string | null;
  createdAt: string;
}

export interface OrganizationsResponse {
  items: OrganizationListItem[];
}

export interface OrganizationCreateResponse {
  item: OrganizationListItem;
}

export interface ImportBatchListItem {
  batchId: string;
  filename: string;
  listType: "general_canvass_list" | "homeowner_leads" | "sold_properties" | "solar_permits" | "roofing_permits" | "custom";
  visibilityScope: "organization" | "team" | "assigned_user";
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  status: string;
  totalRows: number;
  detectedRows: number;
  insertedCount: number;
  updatedCount: number;
  duplicateMatchedCount: number;
  pendingAnalysisCount: number;
  analyzingCount: number;
  analyzedCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface ImportAssignmentOption {
  id: string;
  label: string;
}

export interface ImportsResponse {
  items: ImportBatchListItem[];
  sharedDatasets: SharedDatasetAccessListItem[];
  options: {
    teams: ImportAssignmentOption[];
    users: ImportAssignmentOption[];
  };
  access: {
    billingPlan: OrganizationBillingPlan;
    requiresContributionConsent: boolean;
    contributedUploadsOnly: boolean;
    hasCurrentConsent: boolean;
    consentVersion: string | null;
    acceptedAt: string | null;
  };
}

export interface ImportUploadResponse {
  batchId: string;
  insertedCount: number;
  updatedCount: number;
  duplicateMatchedCount: number;
  pendingAnalysisCount: number;
}

export interface ImportBatchItemDetail {
  itemId: string;
  leadId: string | null;
  sourceRowNumber: number | null;
  rawAddress: string | null;
  normalizedAddress: string | null;
  ingestStatus: string;
  analysisStatus: string;
  analysisError: string | null;
  createdAt: string | null;
}

export interface ImportBatchDetailResponse {
  item: ImportBatchListItem & {
    sourceName: string | null;
    sourceType: string | null;
    notes: string | null;
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    items: ImportBatchItemDetail[];
  };
}

export interface ImportBatchAnalysisResponse {
  batchId: string;
  status: string;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  continued: boolean;
  pendingAnalysisCount: number;
  analyzingCount: number;
  analyzedCount: number;
  failedItemCount: number;
  lastError: string | null;
}

export interface PlatformDatasetOrganizationGrant {
  organizationId: string;
  organizationName: string;
  status: string;
  visibilityScope: "organization" | "team" | "assigned_user";
  assignedTeamName: string | null;
  assignedUserName: string | null;
  grantedAt: string;
}

export interface PlatformDatasetOrganizationStatus {
  organizationId: string;
  organizationName: string;
  label: "Platform Source" | "Included by Intelligence" | "Marketplace Eligible" | "No Access";
  matchingTargetCount: number;
}

export interface PlatformDatasetItem {
  datasetId: string;
  name: string;
  description: string | null;
  sourceBatchId: string;
  sourceOrganizationId: string;
  sourceOrganizationName: string;
  listType: "general_canvass_list" | "homeowner_leads" | "sold_properties" | "solar_permits" | "roofing_permits" | "custom";
  rowCount: number;
  coverage: {
    cities: string[];
    zips: string[];
  };
  organizationStatuses: PlatformDatasetOrganizationStatus[];
  status: "active" | "archived";
  createdAt: string;
  grants: PlatformDatasetOrganizationGrant[];
}

export interface SharedDatasetAccessListItem {
  datasetId: string;
  name: string;
  description: string | null;
  sourceOrganizationName: string;
  listType: "general_canvass_list" | "homeowner_leads" | "sold_properties" | "solar_permits" | "roofing_permits" | "custom";
  rowCount: number;
  visibilityScope: "organization" | "team" | "assigned_user";
  assignedTeamName: string | null;
  assignedUserName: string | null;
  grantedAt: string;
  status: "active" | "paused" | "revoked";
}

export interface PlatformDatasetsResponse {
  items: PlatformDatasetItem[];
}

export interface PlatformOrganizationDatasetEntitlementsResponse {
  item: PlatformOrganizationDatasetEntitlements;
}

export type QRCodeEventType =
  | "scan"
  | "call_click"
  | "text_click"
  | "email_click"
  | "website_click"
  | "book_click"
  | "save_contact"
  | "appointment_booked";

export type QRCodeType = "contact_card" | "campaign_tracker";
export type QRAppointmentType = "phone_call" | "in_person_consult";
export interface QRBookingTypeConfig {
  type: QRAppointmentType;
  enabled: boolean;
  label: string;
  shortDescription: string | null;
  fullDescription: string | null;
  durationMinutes: number;
  preBufferMinutes: number;
  postBufferMinutes: number;
  slotStepMinutes: number;
}

export interface QRCodeContactCardPayload {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  photoUrl: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bookingEnabled: boolean;
  bookingBlurb: string | null;
  organizationName: string | null;
  appName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  bookingTypes: QRBookingTypeConfig[];
  availability: {
    timezone: string;
    workingDays: number[];
    startTime: string;
    endTime: string;
    minNoticeHours: number;
    maxDaysOut: number;
  };
}

export interface QRCodeCampaignTrackerPayload {
  destinationUrl: string;
  description: string | null;
}

export interface QRCodeListItem {
  qrCodeId: string;
  ownerUserId: string;
  ownerName: string | null;
  territoryId: string | null;
  territoryName: string | null;
  label: string;
  slug: string;
  codeType: QRCodeType;
  status: "active" | "paused" | "archived";
  publicUrl: string;
  publicBookingUrl: string;
  createdAt: string;
  payload: QRCodeContactCardPayload | QRCodeCampaignTrackerPayload;
  stats: {
    scans: number;
    appointmentsBooked: number;
    saveContacts: number;
    calls: number;
    texts: number;
    emails: number;
    websiteClicks: number;
    lastScanAt: string | null;
    topCities: string[];
  };
}

export interface QRCodeHubResponse {
  items: QRCodeListItem[];
}

export interface QRCodeCreateResponse {
  item: QRCodeListItem;
}

export interface PublicQRCodeResponse {
  item: {
    qrCodeId: string;
    organizationId: string;
    label: string;
    slug: string;
    publicUrl: string;
    publicBookingUrl: string;
    ownerName: string | null;
    payload: QRCodeContactCardPayload;
  } | null;
}

export interface QrAvailabilitySlot {
  startAt: string;
  label: string;
}

export interface QrAvailabilityDay {
  dateKey: string;
  dateLabel: string;
  slots: QrAvailabilitySlot[];
}

export interface PublicQrAvailabilityResponse {
  timezone: string;
  appointmentType: QRAppointmentType;
  appointmentTypeLabel: string;
  days: QrAvailabilityDay[];
}

export interface UserBookingProfileResponse {
  item: {
    availability: QRCodeContactCardPayload["availability"];
    bookingTypes: QRBookingTypeConfig[];
  };
}

export type ResourceMaterialType = "document" | "video" | "printable";

export interface OrganizationResourceItem {
  resourceId: string;
  title: string;
  description: string | null;
  resourceType: ResourceMaterialType;
  territoryId: string | null;
  territoryName: string | null;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number;
  uploaderUserId: string;
  uploaderName: string | null;
  signedUrl: string | null;
  createdAt: string;
}

export interface ResourcesResponse {
  canManageResources: boolean;
  items: OrganizationResourceItem[];
}

export interface ResourceUploadTargetResponse {
  bucket: string;
  path: string;
  token: string;
}

export interface QRPhotoUploadTargetResponse {
  bucket: string;
  path: string;
  token: string;
  publicUrl: string;
}

export interface OrganizationBrandLogoUploadTargetResponse {
  bucket: string;
  path: string;
  token: string;
  publicUrl: string;
}

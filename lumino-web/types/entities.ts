export type MapState =
  | "unworked_property"
  | "imported_target"
  | "canvassed"
  | "canvassed_with_lead"
  | "not_home"
  | "left_doorhanger"
  | "opportunity"
  | "interested"
  | "callback_requested"
  | "not_interested"
  | "disqualified"
  | "follow_up_overdue"
  | "appointment_set"
  | "customer"
  | "do_not_knock";

export type FollowUpState = "none" | "due_today" | "scheduled_future" | "overdue";
export type PropertyPriorityBand = "high" | "medium" | "low";
export type LeadInterestLevel = "low" | "medium" | "high";
export type LeadDecisionMakerStatus = "all_present" | "spouse_missing" | "other_missing";
export type LeadPreferredChannel = "text" | "call" | "door";
export type LeadObjectionType = "price" | "timing" | "trust" | "roof" | "needs_numbers" | "spouse" | "none";
export type LeadAppointmentOutcome =
  | "sat_not_closed"
  | "moved"
  | "canceled"
  | "no_show"
  | "closed";
export type LeadCadenceTrack =
  | "warm_no_contact"
  | "warm_with_contact"
  | "appointment_active"
  | "post_appt_spouse"
  | "post_appt_numbers"
  | "post_appt_price"
  | "post_appt_timing"
  | "post_appt_trust"
  | "rebook_recovery"
  | "customer_onboarding";

export interface OrganizationFeatureAccess {
  mapEnabled: boolean;
  doorKnockingEnabled: boolean;
  visitLoggingEnabled: boolean;
  leadsEnabled: boolean;
  crmEnabled: boolean;
  appointmentsEnabled: boolean;
  selfImportsEnabled: boolean;
  advancedImportsEnabled: boolean;
  tasksEnabled: boolean;
  teamManagementEnabled: boolean;
  territoriesEnabled: boolean;
  solarCheckEnabled: boolean;
  importEnrichmentEnabled: boolean;
  bulkSolarEnrichmentEnabled: boolean;
  clusterAnalysisEnabled: boolean;
  premiumRoutingInsightsEnabled: boolean;
  datasetMarketplaceEnabled: boolean;
  enrichmentEnabled: boolean;
  priorityScoringEnabled: boolean;
  territoryPlanningEnabled: boolean;
  securityConsoleEnabled: boolean;
}

export interface MapProperty {
  propertyId: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number;
  lng: number;
  mapState: MapState;
  followUpState: FollowUpState;
  visitCount: number;
  notHomeCount: number;
  lastVisitOutcome: string | null;
  leadId: string | null;
  leadStatus: string | null;
  appointmentAt: string | null;
  priorityScore: number;
  priorityBand: PropertyPriorityBand;
}

export interface VisitInput {
  propertyId: string;
  outcome: string;
  notes?: string;
  interestLevel?: "low" | "medium" | "high" | null;
  lat?: number | null;
  lng?: number | null;
  capturedAt?: string | null;
  routeRunId?: string | null;
  routeRunStopId?: string | null;
}

export interface LeadInput {
  propertyId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  leadStatus?: string;
  interestLevel?: LeadInterestLevel | null;
  nextFollowUpAt?: string | null;
  appointmentAt?: string | null;
  decisionMakerStatus?: LeadDecisionMakerStatus | null;
  preferredChannel?: LeadPreferredChannel | null;
  bestContactTime?: string | null;
  textConsent?: boolean | null;
  objectionType?: LeadObjectionType | null;
  billReceived?: boolean | null;
  proposalPresented?: boolean | null;
  appointmentOutcome?: LeadAppointmentOutcome | null;
  rescheduleReason?: string | null;
  cancellationReason?: string | null;
  engagementScore?: number | null;
  cadenceTrack?: LeadCadenceTrack | null;
}

export interface TaskInput {
  propertyId?: string | null;
  leadId?: string | null;
  type:
    | "call"
    | "text"
    | "revisit"
    | "appointment_confirm"
    | "proposal_follow_up"
    | "rebook_appointment"
    | "customer_check_in"
    | "referral_request"
    | "manager_review"
    | "custom";
  dueAt?: string | null;
  notes?: string | null;
}

export interface PropertyVisitHistoryItem {
  id: string;
  outcome: string;
  notes: string | null;
  capturedAt: string;
  userId: string | null;
}

export interface PropertyActivityItem {
  id: string;
  type: string;
  createdAt: string;
  actorUserId: string | null;
  data: Record<string, unknown>;
}

export interface PropertySourceRecordItem {
  id: string;
  sourceType: string;
  sourceName: string | null;
  sourceBatchId: string | null;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  recordDate: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface PropertyFactsSnapshot {
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  lotSizeSqft: number | null;
  yearBuilt: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  propertyType: string | null;
  listingStatus: string | null;
  saleType: string | null;
  daysOnMarket: number | null;
  hoaMonthly: number | null;
  dataCompletenessScore: number | null;
  solarFitScore: number | null;
  roofCapacityScore: number | null;
  roofComplexityScore: number | null;
  estimatedSystemCapacityKw: number | null;
  estimatedYearlyEnergyKwh: number | null;
  solarImageryQuality: string | null;
  propertyPriorityScore: number | null;
  propertyPriorityLabel: string | null;
}

export interface PropertyEnrichmentItem {
  id: string;
  provider: string;
  enrichmentType: string;
  status: string;
  fetchedAt: string;
  expiresAt: string | null;
  payload: Record<string, unknown>;
}

export interface PropertyDetail {
  propertyId: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  mapState: MapState;
  followUpState: FollowUpState;
  visitCount: number;
  notHomeCount: number;
  lastVisitOutcome: string | null;
  lastVisitedAt: string | null;
  leadId: string | null;
  leadStatus: string | null;
  ownerId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  leadNotes: string | null;
  interestLevel?: LeadInterestLevel | null;
  decisionMakerStatus?: LeadDecisionMakerStatus | null;
  preferredChannel?: LeadPreferredChannel | null;
  bestContactTime?: string | null;
  textConsent?: boolean | null;
  objectionType?: LeadObjectionType | null;
  billReceived?: boolean | null;
  proposalPresented?: boolean | null;
  appointmentOutcome?: LeadAppointmentOutcome | null;
  rescheduleReason?: string | null;
  cancellationReason?: string | null;
  engagementScore?: number | null;
  cadenceTrack?: LeadCadenceTrack | null;
  leadNextFollowUpAt: string | null;
  appointmentAt: string | null;
  priorityScore: number;
  priorityBand: PropertyPriorityBand;
  prioritySummary: string;
  featureAccess: OrganizationFeatureAccess;
  recentVisits: PropertyVisitHistoryItem[];
  recentActivities: PropertyActivityItem[];
  facts: PropertyFactsSnapshot;
  enrichments: PropertyEnrichmentItem[];
  sourceRecords: PropertySourceRecordItem[];
  isPreview?: boolean;
}

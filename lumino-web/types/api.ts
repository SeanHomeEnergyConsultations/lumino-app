import type { MapProperty, PropertyDetail } from "@/types/entities";

export interface MapPropertiesResponse {
  items: MapProperty[];
}

export interface VisitResponse {
  visitId: string;
  propertyId: string;
}

export interface PropertyDetailResponse {
  item: PropertyDetail;
}

export interface ResolvePropertyResponse {
  propertyId: string;
  created: boolean;
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

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
  repScorecards: ManagerRepScorecard[];
  recentActivity: ManagerRecentActivityItem[];
  leakage: {
    overdueCount: number;
    staleOpportunityCount: number;
    items: ManagerLeakageItem[];
  };
}

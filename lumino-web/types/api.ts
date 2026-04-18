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

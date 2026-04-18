export type MapState =
  | "unworked_property"
  | "imported_target"
  | "canvassed"
  | "canvassed_with_lead"
  | "interested"
  | "callback_requested"
  | "not_interested"
  | "follow_up_overdue"
  | "appointment_set"
  | "customer"
  | "do_not_knock";

export type FollowUpState = "none" | "due_today" | "scheduled_future" | "overdue";

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
  lastVisitOutcome: string | null;
  leadId: string | null;
  leadStatus: string | null;
  appointmentAt: string | null;
}

export interface VisitInput {
  propertyId: string;
  outcome: string;
  notes?: string;
  interestLevel?: "low" | "medium" | "high" | null;
  lat?: number | null;
  lng?: number | null;
  capturedAt?: string | null;
}

export interface LeadInput {
  propertyId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  leadStatus?: string;
  interestLevel?: "low" | "medium" | "high" | null;
  nextFollowUpAt?: string | null;
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
  leadNextFollowUpAt: string | null;
  appointmentAt: string | null;
  recentVisits: PropertyVisitHistoryItem[];
  recentActivities: PropertyActivityItem[];
}

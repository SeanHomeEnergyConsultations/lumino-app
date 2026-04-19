import type { FollowUpState } from "@/types/entities";

export type PropertyPriorityBand = "high" | "medium" | "low";

export function propertyPriorityBand(score: number): PropertyPriorityBand {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function computeOperationalPropertyPriority(input: {
  basePriorityScore?: number | null;
  solarFitScore?: number | null;
  dataCompletenessScore?: number | null;
  sourceRecordCount?: number;
  hasFirstName?: boolean;
  hasLastName?: boolean;
  hasPhone?: boolean;
  hasEmail?: boolean;
  leadStatus?: string | null;
  followUpState?: FollowUpState | null;
  appointmentAt?: string | null;
  lastVisitOutcome?: string | null;
  lastVisitedAt?: string | null;
  notHomeCount?: number;
}) {
  if (input.lastVisitOutcome === "do_not_knock") {
    return { score: 0, band: "low" as const, summary: "Suppressed by do not knock" };
  }

  let score = Math.max(0, input.basePriorityScore ?? 0);
  score += Math.min(20, Math.max(0, (input.solarFitScore ?? 0) * 4));
  score += Math.min(10, Math.round(Math.max(0, input.dataCompletenessScore ?? 0) / 10));
  score += Math.min(8, Math.max(0, input.sourceRecordCount ?? 0) * 2);

  if (input.hasFirstName || input.hasLastName) score += 5;
  if (input.hasPhone) score += 8;
  if (input.hasEmail) score += 4;

  if (input.leadStatus === "Connected" || input.leadStatus === "Qualified" || input.leadStatus === "Nurture") {
    score += 10;
  }
  if (input.leadStatus === "Appointment Set" || input.appointmentAt) {
    score += 14;
  }
  if (input.followUpState === "overdue") {
    score += 12;
  } else if (input.followUpState === "due_today") {
    score += 8;
  } else if (input.followUpState === "scheduled_future") {
    score += 3;
  }

  if (input.lastVisitOutcome === "opportunity") score += 12;
  if (input.lastVisitOutcome === "left_doorhanger") score += 4;
  if (input.lastVisitOutcome === "not_interested") score -= 18;
  if (input.lastVisitOutcome === "disqualified" || input.leadStatus === "Closed Lost") score -= 24;

  const notHomeCount = input.notHomeCount ?? 0;
  if (notHomeCount >= 4) {
    score -= 18;
  } else if (notHomeCount >= 2) {
    score -= 10;
  }

  if (input.lastVisitedAt) {
    const ageMs = Date.now() - new Date(input.lastVisitedAt).getTime();
    const days = ageMs / (1000 * 60 * 60 * 24);
    if (days < 2 && input.followUpState !== "overdue" && !input.appointmentAt) {
      score -= 6;
    }
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = propertyPriorityBand(clamped);

  let summary = "Lower confidence knock target";
  if (band === "high" && (input.appointmentAt || input.followUpState === "overdue")) {
    summary = "High-priority follow-up property";
  } else if (band === "high" && (input.solarFitScore ?? 0) >= 4) {
    summary = "High solar fit with strong contact signals";
  } else if (band === "medium" && notHomeCount >= 2) {
    summary = "Good target, reduced by repeated not-home attempts";
  } else if (band === "medium") {
    summary = "Worth working when nearby";
  } else if (input.lastVisitOutcome === "disqualified" || input.leadStatus === "Closed Lost") {
    summary = "Lower priority because the property was disqualified";
  }

  return { score: clamped, band, summary };
}

export function computeAnalysisBackedPropertyPriority(input: {
  analysisPriorityScore?: number | null;
  solarFitScore?: number | null;
  valueScore?: number | null;
  sqftScore?: number | null;
  systemCapacityKw?: number | null;
}) {
  let score = 0;
  score += Math.max(0, input.analysisPriorityScore ?? 0) * 15;
  score += Math.max(0, input.solarFitScore ?? 0) * 5;
  score += Math.max(0, input.valueScore ?? 0) * 4;
  score += Math.max(0, input.sqftScore ?? 0) * 3;

  const systemCapacity = input.systemCapacityKw ?? 0;
  if (systemCapacity >= 10) score += 10;
  else if (systemCapacity >= 7) score += 6;
  else if (systemCapacity >= 4) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

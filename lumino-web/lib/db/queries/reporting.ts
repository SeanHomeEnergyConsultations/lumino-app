import type { ManagerDailySummaryResponse } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";
import { getManagerDashboard } from "@/lib/db/queries/dashboard";

function formatLocalDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function buildHeadline(summary: ManagerDailySummaryResponse["summary"]) {
  if (summary.opportunitiesToday >= 5) {
    return "The team created strong opportunity volume today and kept the field moving.";
  }
  if (summary.knocksToday >= 25) {
    return "Activity was healthy today, but conversion discipline matters more than raw volume next.";
  }
  if (summary.knocksToday === 0) {
    return "No field activity was logged today, so manager follow-up matters immediately.";
  }
  return "The team kept activity moving today, with a few places that still need tighter follow-through.";
}

export async function getDailySummaryReport(
  context: AuthSessionContext
): Promise<ManagerDailySummaryResponse> {
  const dashboard = await getManagerDashboard(context);
  const today = new Date();
  const topRep = dashboard.repScorecards[0] ?? null;
  const topNeighborhood = dashboard.neighborhoods[0] ?? null;
  const strongestTerritory = dashboard.territories.find((item) => item.health === "strong") ?? dashboard.territories[0] ?? null;

  const highlights = [
    `${dashboard.summary.knocksToday} knocks were logged across ${dashboard.summary.activeReps} active reps.`,
    `${dashboard.summary.opportunitiesToday} opportunities and ${dashboard.summary.appointmentsToday} appointments were created today.`,
    topRep
      ? `${topRep.fullName ?? topRep.email ?? "Top rep"} led the team with ${topRep.opportunities} opportunities on ${topRep.knocks} knocks.`
      : "No rep leaderboard is available yet because there was no field activity.",
    topNeighborhood
      ? `${[topNeighborhood.city, topNeighborhood.state].filter(Boolean).join(", ") || "The top neighborhood"} produced ${topNeighborhood.opportunities} opportunities on ${topNeighborhood.knocks} knocks.`
      : "No neighborhood performance signal is available yet."
  ];

  const risks = [
    dashboard.summary.overdueFollowUps
      ? `${dashboard.summary.overdueFollowUps} follow-ups are overdue and need manager attention.`
      : "No overdue follow-ups are currently open.",
    dashboard.leakage.staleOpportunityCount
      ? `${dashboard.leakage.staleOpportunityCount} opportunities are stale with no next step scheduled.`
      : "No stale opportunities are leaking right now.",
    dashboard.alerts[0]?.body ?? "No urgent manager alerts are active right now."
  ];

  const territoryNotes = strongestTerritory
    ? `${strongestTerritory.name} is the strongest territory signal right now with ${strongestTerritory.opportunitiesToday} opportunities today.`
    : "No territory signals are available yet because territories have not been assigned.";

  const summary = {
    knocksToday: dashboard.summary.knocksToday,
    activeReps: dashboard.summary.activeReps,
    opportunitiesToday: dashboard.summary.opportunitiesToday,
    appointmentsToday: dashboard.summary.appointmentsToday,
    overdueFollowUps: dashboard.summary.overdueFollowUps,
    staleOpportunities: dashboard.leakage.staleOpportunityCount
  };

  const dateLabel = formatLocalDate(today);
  const headline = buildHeadline(summary);
  const emailSubject = `Lumino daily summary - ${today.toLocaleDateString("en-US")}`;
  const emailBody = [
    `Lumino daily summary for ${dateLabel}`,
    "",
    headline,
    "",
    "Scoreboard",
    `- Active reps: ${summary.activeReps}`,
    `- Knocks today: ${summary.knocksToday}`,
    `- Opportunities today: ${summary.opportunitiesToday}`,
    `- Appointments today: ${summary.appointmentsToday}`,
    `- Overdue follow-ups: ${summary.overdueFollowUps}`,
    `- Stale opportunities: ${summary.staleOpportunities}`,
    "",
    "Highlights",
    ...highlights.map((item) => `- ${item}`),
    "",
    "Risks",
    ...risks.map((item) => `- ${item}`),
    "",
    "Territory note",
    `- ${territoryNotes}`
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    dateLabel,
    headline,
    summary,
    highlights,
    risks,
    territoryNotes,
    emailSubject,
    emailBody
  };
}

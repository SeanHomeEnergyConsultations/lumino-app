import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type {
  ManagerAlertItem,
  ManagerCoachingFlag,
  ManagerDashboardResponse,
  ManagerLeakageItem,
  ManagerMapPoint,
  ManagerNeighborhoodPerformanceItem,
  ManagerNeighborhoodTrendItem,
  ManagerRepPresenceItem,
  ManagerRecentActivityItem,
  ManagerRepScorecard,
  ManagerTerritorySummaryItem
} from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function formatRate(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function minutesBetween(first: string | null, last: string | null) {
  if (!first || !last) return 0;
  const start = new Date(first).getTime();
  const end = new Date(last).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function subtractDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function severityFromValue(value: number, mediumThreshold: number, highThreshold: number) {
  if (value >= highThreshold) return "high" as const;
  if (value >= mediumThreshold) return "medium" as const;
  return "low" as const;
}

export async function getManagerDashboard(context: AuthSessionContext): Promise<ManagerDashboardResponse> {
  const supabase = createServerSupabaseClient();

  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const todayIso = startOfTodayIso();
  const nowIso = new Date().toISOString();
  const fourHoursAgoIso = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const eightDaysAgoIso = subtractDaysIso(8);

  const [
    { data: membershipRows, error: membershipsError },
    { data: visitRows, error: visitsError },
    { data: overdueRows, error: overdueError },
    { data: staleRows, error: staleError },
    { data: overdueLeakageRows, error: overdueLeakageError },
    { data: recentVisits, error: recentVisitsError },
    { data: recentLeadActivities, error: recentLeadActivitiesError },
    { data: territoryRows, error: territoryError },
    { data: propertyTerritoryRows, error: propertyTerritoryError },
    { data: supervisionVisitRows, error: supervisionVisitsError },
    { data: trailingVisitRows, error: trailingVisitsError }
  ] = await Promise.all([
    supabase
      .from("organization_members")
      .select("user_id,role")
      .eq("organization_id", context.organizationId)
      .eq("is_active", true),
    supabase
      .from("visits")
      .select("id,user_id,outcome,captured_at,property_id")
      .eq("organization_id", context.organizationId)
      .gte("captured_at", todayIso),
    supabase
      .from("leads")
      .select("id,owner_id,assigned_to")
      .eq("organization_id", context.organizationId)
      .eq("status", "open")
      .lt("next_follow_up_at", nowIso),
    supabase
      .from("leads")
      .select("id,property_id,address,lead_status,next_follow_up_at,last_activity_at")
      .eq("organization_id", context.organizationId)
      .eq("status", "open")
      .in("lead_status", ["Connected", "Qualified"])
      .is("next_follow_up_at", null)
      .order("last_activity_at", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase
      .from("leads")
      .select("id,property_id,address,lead_status,next_follow_up_at,last_activity_at")
      .eq("organization_id", context.organizationId)
      .eq("status", "open")
      .lt("next_follow_up_at", nowIso)
      .order("next_follow_up_at", { ascending: true })
      .limit(6),
    supabase
      .from("visits")
      .select("id,user_id,outcome,captured_at,property_id")
      .eq("organization_id", context.organizationId)
      .order("captured_at", { ascending: false })
      .limit(12),
    supabase
      .from("activities")
      .select("id,actor_user_id,created_at,type,data,entity_id")
      .eq("organization_id", context.organizationId)
      .eq("entity_type", "lead")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("territories")
      .select("id,name,status")
      .eq("organization_id", context.organizationId)
      .limit(8),
    supabase
      .from("property_territories")
      .select("property_id,territory_id")
      .eq("organization_id", context.organizationId),
    supabase
      .from("visits")
      .select("id,user_id,outcome,captured_at,property_id,lat,lng")
      .eq("organization_id", context.organizationId)
      .gte("captured_at", fourHoursAgoIso)
      .order("captured_at", { ascending: false })
      .limit(60),
    supabase
      .from("visits")
      .select("outcome,captured_at,property_id")
      .eq("organization_id", context.organizationId)
      .gte("captured_at", eightDaysAgoIso)
  ]);

  if (membershipsError) throw membershipsError;
  if (visitsError) throw visitsError;
  if (overdueError) throw overdueError;
  if (staleError) throw staleError;
  if (overdueLeakageError) throw overdueLeakageError;
  if (recentVisitsError) throw recentVisitsError;
  if (recentLeadActivitiesError) throw recentLeadActivitiesError;
  if (territoryError) throw territoryError;
  if (propertyTerritoryError) throw propertyTerritoryError;
  if (supervisionVisitsError) throw supervisionVisitsError;
  if (trailingVisitsError) throw trailingVisitsError;

  const members = membershipRows ?? [];
  const visits = visitRows ?? [];
  const overdue = overdueRows ?? [];
  const stale = staleRows ?? [];
  const overdueLeakage = overdueLeakageRows ?? [];
  const recentVisitRows = recentVisits ?? [];
  const recentLeadRows = recentLeadActivities ?? [];
  const territories = territoryRows ?? [];
  const propertyTerritories = propertyTerritoryRows ?? [];
  const supervisionVisits = supervisionVisitRows ?? [];
  const trailingVisits = trailingVisitRows ?? [];

  const userIds = [
    ...new Set([
      ...members.map((row) => row.user_id as string),
      ...recentVisitRows.map((row) => row.user_id as string | null).filter(Boolean),
      ...recentLeadRows.map((row) => row.actor_user_id as string | null).filter(Boolean)
    ])
  ];

  const propertyIds = [
    ...new Set([
      ...recentVisitRows.map((row) => row.property_id as string | null).filter(Boolean),
      ...visits.map((row) => row.property_id as string | null).filter(Boolean),
      ...stale.map((row) => row.property_id as string | null).filter(Boolean),
      ...overdueLeakage.map((row) => row.property_id as string | null).filter(Boolean)
      ,
      ...supervisionVisits.map((row) => row.property_id as string | null).filter(Boolean),
      ...trailingVisits.map((row) => row.property_id as string | null).filter(Boolean)
    ])
  ];

  const [{ data: appUsers, error: appUsersError }, { data: propertyRows, error: propertyRowsError }] =
    await Promise.all([
      userIds.length
        ? supabase.from("app_users").select("id,full_name,email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      propertyIds.length
        ? supabase
            .from("property_history_view")
            .select("property_id,raw_address,city,state,lat,lng")
            .in("property_id", propertyIds)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (appUsersError) throw appUsersError;
  if (propertyRowsError) throw propertyRowsError;

  const userMap = new Map((appUsers ?? []).map((row) => [row.id as string, row]));
  const propertyMap = new Map((propertyRows ?? []).map((row) => [row.property_id as string, row]));

  const overdueByOwner = new Map<string, number>();
  for (const lead of overdue) {
    const ownerId = (lead.owner_id as string | null) ?? (lead.assigned_to as string | null);
    if (!ownerId) continue;
    overdueByOwner.set(ownerId, (overdueByOwner.get(ownerId) ?? 0) + 1);
  }

  const visitsByUser = new Map<string, typeof visits>();
  for (const visit of visits) {
    const userId = visit.user_id as string | null;
    if (!userId) continue;
    const current = visitsByUser.get(userId) ?? [];
    current.push(visit);
    visitsByUser.set(userId, current);
  }

  const repScorecards: ManagerRepScorecard[] = members
    .filter((row) => ["owner", "admin", "manager", "rep", "setter"].includes((row.role as string) ?? ""))
    .map((row) => {
      const userId = row.user_id as string;
      const userVisits = visitsByUser.get(userId) ?? [];
      const sortedVisits = [...userVisits].sort(
        (a, b) => new Date(a.captured_at as string).getTime() - new Date(b.captured_at as string).getTime()
      );
      const knocks = userVisits.length;
      const opportunities = userVisits.filter((visit) => visit.outcome === "opportunity").length;
      const appointments = userVisits.filter((visit) => visit.outcome === "appointment_set").length;
      const notHome = userVisits.filter((visit) => visit.outcome === "not_home").length;
      const doorhangers = userVisits.filter((visit) => visit.outcome === "left_doorhanger").length;
      const memberUser = userMap.get(userId);

      return {
        userId,
        fullName: memberUser?.full_name ?? null,
        email: memberUser?.email ?? null,
        role: row.role as string,
        knocks,
        notHome,
        doorhangers,
        opportunities,
        appointments,
        overdueFollowUps: overdueByOwner.get(userId) ?? 0,
        opportunityRate: formatRate(opportunities, knocks),
        activeWindowMinutes: minutesBetween(
          (sortedVisits[0]?.captured_at as string | null) ?? null,
          (sortedVisits[sortedVisits.length - 1]?.captured_at as string | null) ?? null
        )
      };
    })
    .sort((a, b) => {
      if (b.opportunities !== a.opportunities) return b.opportunities - a.opportunities;
      return b.knocks - a.knocks;
    });

  const recentActivity: ManagerRecentActivityItem[] = [
    ...recentVisitRows.map((visit) => ({
      id: `visit-${visit.id as string}`,
      type: "visit" as const,
      address: (propertyMap.get(visit.property_id as string)?.raw_address as string | undefined) ?? "Unknown address",
      outcome: visit.outcome as string | null,
      leadStatus: null,
      actorName: (userMap.get(visit.user_id as string)?.full_name as string | null) ?? null,
      createdAt: visit.captured_at as string
    })),
    ...recentLeadRows.map((activity) => {
      const data = (activity.data as Record<string, unknown> | null) ?? {};
      return {
        id: `lead-${activity.id as string}`,
        type: "lead" as const,
        address: (data.address as string | null) ?? "Lead updated",
        outcome: null,
        leadStatus: (data.lead_status as string | null) ?? null,
        actorName: (userMap.get(activity.actor_user_id as string)?.full_name as string | null) ?? null,
        createdAt: activity.created_at as string
      };
    })
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  const leakageItems: ManagerLeakageItem[] = [
    ...overdueLeakage.map((lead) => ({
      leadId: lead.id as string,
      propertyId: (lead.property_id as string | null) ?? null,
      address:
        ((lead.property_id as string | null) && (propertyMap.get(lead.property_id as string)?.raw_address as string | undefined)) ||
        (lead.address as string) ||
        "Unknown address",
      leadStatus: (lead.lead_status as string | null) ?? null,
      nextFollowUpAt: (lead.next_follow_up_at as string | null) ?? null,
      lastActivityAt: (lead.last_activity_at as string | null) ?? null,
      leakageReason: "overdue_follow_up" as const
    })),
    ...stale.map((lead) => ({
      leadId: lead.id as string,
      propertyId: (lead.property_id as string | null) ?? null,
      address:
        ((lead.property_id as string | null) && (propertyMap.get(lead.property_id as string)?.raw_address as string | undefined)) ||
        (lead.address as string) ||
        "Unknown address",
      leadStatus: (lead.lead_status as string | null) ?? null,
      nextFollowUpAt: (lead.next_follow_up_at as string | null) ?? null,
      lastActivityAt: (lead.last_activity_at as string | null) ?? null,
      leakageReason: "stale_opportunity" as const
    }))
  ].slice(0, 12);

  const summary = {
    activeReps: new Set(visits.map((visit) => visit.user_id as string | null).filter(Boolean)).size,
    knocksToday: visits.length,
    opportunitiesToday: visits.filter((visit) => visit.outcome === "opportunity").length,
    appointmentsToday: visits.filter((visit) => visit.outcome === "appointment_set").length,
    overdueFollowUps: overdue.length
  };

  const neighborhoodMap = new Map<string, ManagerNeighborhoodPerformanceItem>();
  for (const visit of visits) {
    const property = propertyMap.get(visit.property_id as string);
    const city = (property?.city as string | null) ?? null;
    const state = (property?.state as string | null) ?? null;
    const key = `${city ?? "Unknown"}|${state ?? ""}`;
    const current = neighborhoodMap.get(key) ?? {
      city,
      state,
      knocks: 0,
      opportunities: 0,
      appointments: 0,
      notHome: 0,
      opportunityRate: 0
    };

    current.knocks += 1;
    if (visit.outcome === "opportunity") current.opportunities += 1;
    if (visit.outcome === "appointment_set") current.appointments += 1;
    if (visit.outcome === "not_home") current.notHome += 1;
    current.opportunityRate = formatRate(current.opportunities, current.knocks);
    neighborhoodMap.set(key, current);
  }

  const neighborhoods = [...neighborhoodMap.values()]
    .sort((a, b) => {
      if (b.opportunities !== a.opportunities) return b.opportunities - a.opportunities;
      return b.knocks - a.knocks;
    })
    .slice(0, 8);

  const territoryByProperty = new Map<string, string[]>();
  for (const row of propertyTerritories) {
    const propertyId = row.property_id as string;
    const current = territoryByProperty.get(propertyId) ?? [];
    current.push(row.territory_id as string);
    territoryByProperty.set(propertyId, current);
  }

  const territorySummaries: ManagerTerritorySummaryItem[] = territories.map((territory) => {
    const territoryId = territory.id as string;
    const propertyIdsForTerritory = propertyTerritories
      .filter((row) => row.territory_id === territoryId)
      .map((row) => row.property_id as string);
    const visitsForTerritory = visits.filter((visit) =>
      (territoryByProperty.get(visit.property_id as string) ?? []).includes(territoryId)
    );

    return {
      territoryId,
      name: territory.name as string,
      status: territory.status as string,
      propertyCount: new Set(propertyIdsForTerritory).size,
      knocksToday: visitsForTerritory.length,
      opportunitiesToday: visitsForTerritory.filter((visit) => visit.outcome === "opportunity").length,
      appointmentsToday: visitsForTerritory.filter((visit) => visit.outcome === "appointment_set").length,
      health:
        visitsForTerritory.filter((visit) => visit.outcome === "opportunity").length >= 3
          ? "strong"
          : visitsForTerritory.length >= 3
            ? "mixed"
            : "cold"
    };
  });

  const repPresenceMap = new Map<string, ManagerRepPresenceItem>();
  for (const visit of supervisionVisits) {
    const userId = visit.user_id as string | null;
    if (!userId || repPresenceMap.has(userId)) continue;
    const property = propertyMap.get(visit.property_id as string);
    repPresenceMap.set(userId, {
      userId,
      fullName: (userMap.get(userId)?.full_name as string | null) ?? null,
      lastSeenAt: visit.captured_at as string,
      lastOutcome: visit.outcome as string | null,
      lat: (visit.lat as number | null) ?? ((property?.lat as number | null) ?? null),
      lng: (visit.lng as number | null) ?? ((property?.lng as number | null) ?? null)
    });
  }

  const supervisionMap: ManagerMapPoint[] = supervisionVisits
    .map((visit) => {
      const property = propertyMap.get(visit.property_id as string);
      const lat = (visit.lat as number | null) ?? ((property?.lat as number | null) ?? null);
      const lng = (visit.lng as number | null) ?? ((property?.lng as number | null) ?? null);
      if (lat == null || lng == null) return null;

      return {
        id: visit.id as string,
        propertyId: visit.property_id as string,
        address: (property?.raw_address as string | undefined) ?? "Unknown address",
        lat,
        lng,
        outcome: visit.outcome as string | null,
        actorName: (userMap.get(visit.user_id as string)?.full_name as string | null) ?? null,
        capturedAt: visit.captured_at as string
      };
    })
    .filter((item): item is ManagerMapPoint => Boolean(item));

  const trendMap = new Map<string, ManagerNeighborhoodTrendItem>();
  for (const visit of trailingVisits) {
    const property = propertyMap.get(visit.property_id as string);
    const city = (property?.city as string | null) ?? null;
    const state = (property?.state as string | null) ?? null;
    const key = `${city ?? "Unknown"}|${state ?? ""}`;
    const capturedAt = visit.captured_at as string;
    const isToday = capturedAt >= todayIso;
    const current = trendMap.get(key) ?? {
      city,
      state,
      todayKnocks: 0,
      todayOpportunities: 0,
      trailingAvgKnocks: 0,
      trailingAvgOpportunities: 0
    };

    if (isToday) {
      current.todayKnocks += 1;
      if (visit.outcome === "opportunity") current.todayOpportunities += 1;
    } else {
      current.trailingAvgKnocks += 1 / 7;
      if (visit.outcome === "opportunity") current.trailingAvgOpportunities += 1 / 7;
    }

    trendMap.set(key, current);
  }

  const neighborhoodTrends = [...trendMap.values()]
    .map((item) => ({
      ...item,
      trailingAvgKnocks: Math.round(item.trailingAvgKnocks * 10) / 10,
      trailingAvgOpportunities: Math.round(item.trailingAvgOpportunities * 10) / 10
    }))
    .sort((a, b) => b.todayOpportunities - a.todayOpportunities || b.todayKnocks - a.todayKnocks)
    .slice(0, 8);

  const coachingFlags: ManagerCoachingFlag[] = repScorecards
    .flatMap((rep) => {
      const flags: ManagerCoachingFlag[] = [];
      const notHomeRate = rep.knocks ? rep.notHome / rep.knocks : 0;

      if (rep.knocks >= 6 && notHomeRate >= 0.7) {
        flags.push({
          id: `${rep.userId}-not-home-rate`,
          userId: rep.userId,
          repName: rep.fullName ?? rep.email ?? "Rep",
          reason: "High not-home rate",
          detail: `${rep.notHome} of ${rep.knocks} knocks were not home.`,
          severity: severityFromValue(notHomeRate * 100, 70, 80),
          href: `/queue?ownerId=${rep.userId}&repName=${encodeURIComponent(rep.fullName ?? rep.email ?? "Rep")}`
        });
      }

      if (rep.knocks >= 8 && rep.opportunities === 0) {
        flags.push({
          id: `${rep.userId}-zero-opps`,
          userId: rep.userId,
          repName: rep.fullName ?? rep.email ?? "Rep",
          reason: "No opportunities created",
          detail: `${rep.knocks} knocks today without an opportunity.`,
          severity: "high",
          href: `/map?ownerId=${rep.userId}`
        });
      }

      if (rep.overdueFollowUps >= 3) {
        flags.push({
          id: `${rep.userId}-overdue-followups`,
          userId: rep.userId,
          repName: rep.fullName ?? rep.email ?? "Rep",
          reason: "Follow-up ownership risk",
          detail: `${rep.overdueFollowUps} overdue follow-ups are sitting with this rep.`,
          severity: severityFromValue(rep.overdueFollowUps, 3, 5),
          href: `/queue?ownerId=${rep.userId}&repName=${encodeURIComponent(rep.fullName ?? rep.email ?? "Rep")}`
        });
      }

      if (rep.knocks >= 5 && rep.activeWindowMinutes > 0 && rep.activeWindowMinutes <= 20) {
        flags.push({
          id: `${rep.userId}-compressed-window`,
          userId: rep.userId,
          repName: rep.fullName ?? rep.email ?? "Rep",
          reason: "Compressed activity window",
          detail: `${rep.knocks} knocks were logged in about ${rep.activeWindowMinutes} minutes.`,
          severity: "medium",
          href: `/map?ownerId=${rep.userId}`
        });
      }

      return flags;
    })
    .sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      return severityRank[b.severity] - severityRank[a.severity];
    })
    .slice(0, 10);

  const alerts: ManagerAlertItem[] = [];
  if (summary.overdueFollowUps > 0) {
    alerts.push({
      id: "overdue-followups",
      title: "Overdue follow-ups need attention",
      body: `${summary.overdueFollowUps} open leads are already overdue for follow-up.`,
      severity: severityFromValue(summary.overdueFollowUps, 3, 6),
      href: "/map?filters=follow_up_overdue"
    });
  }

  if (stale.length > 0) {
    alerts.push({
      id: "stale-opportunities",
      title: "Stale opportunities are leaking",
      body: `${stale.length} connected or qualified leads still have no next step set.`,
      severity: severityFromValue(stale.length, 2, 4),
      href: "/queue"
    });
  }

  const worstNeighborhood = neighborhoods
    .filter((item) => item.notHome >= 4)
    .sort((a, b) => b.notHome - a.notHome)[0];
  if (worstNeighborhood) {
    alerts.push({
      id: "not-home-cluster",
      title: "Repeated not-home cluster detected",
      body: `${[worstNeighborhood.city, worstNeighborhood.state].filter(Boolean).join(", ") || "One area"} has ${worstNeighborhood.notHome} not-home outcomes today.`,
      severity: severityFromValue(worstNeighborhood.notHome, 4, 7),
      href: `/map?city=${encodeURIComponent(worstNeighborhood.city ?? "")}&state=${encodeURIComponent(worstNeighborhood.state ?? "")}&filters=not_home`
    });
  }

  if (summary.activeReps === 0 && members.length > 0) {
    alerts.push({
      id: "no-active-reps",
      title: "No reps are active right now",
      body: "Nobody has logged field activity today yet.",
      severity: "medium",
      href: "/queue"
    });
  }

  return {
    summary,
    alerts,
    coachingFlags,
    repScorecards,
    recentActivity,
    neighborhoods,
    neighborhoodTrends,
    repPresence: [...repPresenceMap.values()],
    supervisionMap,
    territories: territorySummaries,
    leakage: {
      overdueCount: overdue.length,
      staleOpportunityCount: stale.length,
      items: leakageItems
    }
  };
}

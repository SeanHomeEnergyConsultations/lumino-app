import { hasManagerAccess } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type {
  PerformanceBadgeItem,
  PerformanceCompetitionItem,
  PerformanceCompetitionMetric,
  PerformanceCompetitionStatus,
  PerformanceHubResponse,
  PerformanceLeaderboardEntry,
  PerformanceTeamLeaderboardEntry
} from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

type VisitRow = {
  user_id: string | null;
  outcome: string | null;
  captured_at: string;
};

type MemberRow = {
  user_id: string;
  role: string;
};

type AppUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type CompetitionRow = {
  id: string;
  title: string;
  description: string | null;
  metric: PerformanceCompetitionMetric;
  scope: "individual" | "team";
  period_type: "day" | "week" | "custom";
  start_at: string;
  end_at: string;
  status: PerformanceCompetitionStatus;
};

type TeamRow = {
  id: string;
  name: string;
  manager_id: string | null;
};

type TeamMembershipRow = {
  user_id: string | null;
  team_id: string | null;
};

type ScoreSeed = {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  knocks: number;
  opportunities: number;
  appointments: number;
  doorhangers: number;
};

type TeamScoreSeed = {
  teamId: string;
  name: string;
  managerName: string | null;
  knocks: number;
  opportunities: number;
  appointments: number;
  doorhangers: number;
};

function startOfToday() {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek() {
  const next = startOfToday();
  const day = next.getDay();
  const diff = (day + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
}

function computeMetricValue(
  seed: Pick<ScoreSeed, "knocks" | "opportunities" | "appointments" | "doorhangers">,
  metric: PerformanceCompetitionMetric
) {
  switch (metric) {
    case "appointments":
      return seed.appointments;
    case "opportunities":
      return seed.opportunities;
    case "doorhangers":
      return seed.doorhangers;
    default:
      return seed.knocks;
  }
}

function buildLeaderboard(params: {
  members: MemberRow[];
  users: Map<string, AppUserRow>;
  visits: VisitRow[];
  metric: PerformanceCompetitionMetric;
  currentUserId: string;
}) {
  const seeds = new Map<string, ScoreSeed>();

  for (const member of params.members) {
    const user = params.users.get(member.user_id);
    seeds.set(member.user_id, {
      userId: member.user_id,
      fullName: user?.full_name ?? null,
      email: user?.email ?? null,
      role: member.role,
      knocks: 0,
      opportunities: 0,
      appointments: 0,
      doorhangers: 0
    });
  }

  for (const visit of params.visits) {
    if (!visit.user_id || !seeds.has(visit.user_id)) continue;
    const current = seeds.get(visit.user_id)!;
    current.knocks += 1;
    if (visit.outcome === "opportunity") current.opportunities += 1;
    if (visit.outcome === "appointment_set") current.appointments += 1;
    if (visit.outcome === "left_doorhanger") current.doorhangers += 1;
  }

  return [...seeds.values()]
    .map((seed) => ({
      ...seed,
      metricValue: computeMetricValue(seed, params.metric)
    }))
    .sort((a, b) => {
      if (b.metricValue !== a.metricValue) return b.metricValue - a.metricValue;
      if (b.appointments !== a.appointments) return b.appointments - a.appointments;
      if (b.opportunities !== a.opportunities) return b.opportunities - a.opportunities;
      return b.knocks - a.knocks;
    })
    .map(
      (seed, index): PerformanceLeaderboardEntry => ({
        userId: seed.userId,
        fullName: seed.fullName,
        email: seed.email,
        role: seed.role,
        rank: index + 1,
        metricValue: seed.metricValue,
        knocks: seed.knocks,
        opportunities: seed.opportunities,
        appointments: seed.appointments,
        doorhangers: seed.doorhangers,
        isCurrentUser: seed.userId === params.currentUserId
      })
    );
}

function buildTeamLeaderboard(params: {
  teams: TeamRow[];
  users: Map<string, AppUserRow>;
  teamMemberships: TeamMembershipRow[];
  visits: VisitRow[];
  metric: PerformanceCompetitionMetric;
  currentUserTeamId: string | null;
}) {
  const membershipByUser = new Map<string, string>();
  for (const membership of params.teamMemberships) {
    if (!membership.user_id || !membership.team_id || membershipByUser.has(membership.user_id)) continue;
    membershipByUser.set(membership.user_id, membership.team_id);
  }

  const seeds = new Map<string, TeamScoreSeed>();
  for (const team of params.teams) {
    seeds.set(team.id, {
      teamId: team.id,
      name: team.name,
      managerName: team.manager_id ? params.users.get(team.manager_id)?.full_name ?? null : null,
      knocks: 0,
      opportunities: 0,
      appointments: 0,
      doorhangers: 0
    });
  }

  for (const visit of params.visits) {
    if (!visit.user_id) continue;
    const teamId = membershipByUser.get(visit.user_id);
    if (!teamId || !seeds.has(teamId)) continue;
    const current = seeds.get(teamId)!;
    current.knocks += 1;
    if (visit.outcome === "opportunity") current.opportunities += 1;
    if (visit.outcome === "appointment_set") current.appointments += 1;
    if (visit.outcome === "left_doorhanger") current.doorhangers += 1;
  }

  return [...seeds.values()]
    .map((seed) => ({
      ...seed,
      metricValue: computeMetricValue(seed, params.metric)
    }))
    .sort((a, b) => {
      if (b.metricValue !== a.metricValue) return b.metricValue - a.metricValue;
      if (b.appointments !== a.appointments) return b.appointments - a.appointments;
      if (b.opportunities !== a.opportunities) return b.opportunities - a.opportunities;
      return b.knocks - a.knocks;
    })
    .map(
      (seed, index): PerformanceTeamLeaderboardEntry => ({
        teamId: seed.teamId,
        name: seed.name,
        managerName: seed.managerName,
        rank: index + 1,
        metricValue: seed.metricValue,
        knocks: seed.knocks,
        opportunities: seed.opportunities,
        appointments: seed.appointments,
        doorhangers: seed.doorhangers,
        isCurrentUsersTeam: seed.teamId === params.currentUserTeamId
      })
    );
}

function normalizeCompetitionStatus(row: CompetitionRow) {
  if (row.status === "cancelled") return "cancelled" as const;
  const now = Date.now();
  const start = new Date(row.start_at).getTime();
  const end = new Date(row.end_at).getTime();
  if (end < now) return "completed" as const;
  if (start > now) return "scheduled" as const;
  return "active" as const;
}

function deriveBadges(input: {
  dailyLeaderboard: PerformanceLeaderboardEntry[];
  weeklyLeaderboard: PerformanceLeaderboardEntry[];
  currentUserId: string;
}): PerformanceBadgeItem[] {
  const dailyMine = input.dailyLeaderboard.find((entry) => entry.userId === input.currentUserId) ?? null;
  const weeklyMine = input.weeklyLeaderboard.find((entry) => entry.userId === input.currentUserId) ?? null;
  const badges: PerformanceBadgeItem[] = [];

  if (dailyMine?.rank === 1 && dailyMine.knocks > 0) {
    badges.push({
      id: "daily-pace-setter",
      label: "Daily Pace Setter",
      detail: `You’re leading today with ${dailyMine.knocks} doors knocked.`,
      tone: "gold"
    });
  }

  if (weeklyMine?.rank === 1 && weeklyMine.appointments > 0) {
    badges.push({
      id: "appointment-machine",
      label: "Appointment Machine",
      detail: `You’re leading the week with ${weeklyMine.appointments} appointments set.`,
      tone: "electric"
    });
  }

  if ((dailyMine?.knocks ?? 0) >= 25) {
    badges.push({
      id: "doors-25",
      label: "25 Club",
      detail: "You cleared 25 doors today.",
      tone: "emerald"
    });
  }

  if ((weeklyMine?.opportunities ?? 0) >= 5) {
    badges.push({
      id: "opportunity-builder",
      label: "Opportunity Builder",
      detail: `You’ve created ${weeklyMine?.opportunities ?? 0} opportunities this week.`,
      tone: "silver"
    });
  }

  if (!badges.length) {
    badges.push({
      id: "on-the-board",
      label: "On The Board",
      detail: "Log visits, opportunities, and appointments to unlock live awards.",
      tone: "bronze"
    });
  }

  return badges;
}

export async function getPerformanceHub(context: AuthSessionContext): Promise<PerformanceHubResponse> {
  const supabase = createServerSupabaseClient();

  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const todayStart = startOfToday();
  const weekStart = startOfWeek();

  const [
    { data: membershipRows, error: membershipsError },
    { data: dailyVisits, error: dailyError },
    { data: weeklyVisits, error: weeklyError },
    { data: competitionRows, error: competitionsError },
    { data: teamRows, error: teamsError },
    { data: teamMembershipRows, error: teamMembershipsError }
  ] = await Promise.all([
    supabase
      .from("organization_members")
      .select("user_id,role")
      .eq("organization_id", context.organizationId)
      .eq("is_active", true),
    supabase
      .from("visits")
      .select("user_id,outcome,captured_at")
      .eq("organization_id", context.organizationId)
      .gte("captured_at", todayStart.toISOString()),
    supabase
      .from("visits")
      .select("user_id,outcome,captured_at")
      .eq("organization_id", context.organizationId)
      .gte("captured_at", weekStart.toISOString()),
    supabase
      .from("performance_competitions")
      .select("id,title,description,metric,scope,period_type,start_at,end_at,status")
      .eq("organization_id", context.organizationId)
      .order("start_at", { ascending: false })
      .limit(18),
    supabase
      .from("teams")
      .select("id,name,manager_id")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("team_memberships")
      .select("user_id,team_id")
      .eq("organization_id", context.organizationId)
  ]);

  if (membershipsError) throw membershipsError;
  if (dailyError) throw dailyError;
  if (weeklyError) throw weeklyError;
  if (competitionsError) throw competitionsError;
  if (teamsError) throw teamsError;
  if (teamMembershipsError) throw teamMembershipsError;

  const fieldMembers = (membershipRows ?? []).filter((row) =>
    ["owner", "admin", "manager", "rep", "setter"].includes((row.role as string) ?? "")
  ) as MemberRow[];
  const userIds = [...new Set(fieldMembers.map((row) => row.user_id))];

  const { data: users, error: usersError } = userIds.length
    ? await supabase.from("app_users").select("id,full_name,email").in("id", userIds)
    : { data: [], error: null };
  if (usersError) throw usersError;

  const userMap = new Map(((users ?? []) as AppUserRow[]).map((row) => [row.id, row]));

  const dailyLeaderboard = buildLeaderboard({
    members: fieldMembers,
    users: userMap,
    visits: (dailyVisits ?? []) as VisitRow[],
    metric: "knocks",
    currentUserId: context.appUser.id
  });

  const weeklyLeaderboard = buildLeaderboard({
    members: fieldMembers,
    users: userMap,
    visits: (weeklyVisits ?? []) as VisitRow[],
    metric: "appointments",
    currentUserId: context.appUser.id
  });

  const currentUserTeamId =
    ((teamMembershipRows ?? []) as TeamMembershipRow[]).find((row) => row.user_id === context.appUser.id)?.team_id ?? null;

  const teamDailyLeaderboard = buildTeamLeaderboard({
    teams: (teamRows ?? []) as TeamRow[],
    users: userMap,
    teamMemberships: (teamMembershipRows ?? []) as TeamMembershipRow[],
    visits: (dailyVisits ?? []) as VisitRow[],
    metric: "knocks",
    currentUserTeamId
  });

  const teamWeeklyLeaderboard = buildTeamLeaderboard({
    teams: (teamRows ?? []) as TeamRow[],
    users: userMap,
    teamMemberships: (teamMembershipRows ?? []) as TeamMembershipRow[],
    visits: (weeklyVisits ?? []) as VisitRow[],
    metric: "appointments",
    currentUserTeamId
  });

  const competitionItems: PerformanceCompetitionItem[] = [];
  for (const row of (competitionRows ?? []) as CompetitionRow[]) {
    const { data: competitionVisits, error: competitionVisitsError } = await supabase
      .from("visits")
      .select("user_id,outcome,captured_at")
      .eq("organization_id", context.organizationId)
      .gte("captured_at", row.start_at)
      .lte("captured_at", row.end_at);

    if (competitionVisitsError) throw competitionVisitsError;

    const leaders =
      row.scope === "team"
        ? []
        : buildLeaderboard({
            members: fieldMembers,
            users: userMap,
            visits: (competitionVisits ?? []) as VisitRow[],
            metric: row.metric,
            currentUserId: context.appUser.id
          });
    const teamLeaders =
      row.scope === "team"
        ? buildTeamLeaderboard({
            teams: (teamRows ?? []) as TeamRow[],
            users: userMap,
            teamMemberships: (teamMembershipRows ?? []) as TeamMembershipRow[],
            visits: (competitionVisits ?? []) as VisitRow[],
            metric: row.metric,
            currentUserTeamId
          })
        : [];

    competitionItems.push({
      id: row.id,
      title: row.title,
      description: row.description,
      metric: row.metric,
      scope: row.scope,
      periodType: row.period_type,
      startAt: row.start_at,
      endAt: row.end_at,
      status: normalizeCompetitionStatus(row),
      leaders: leaders.slice(0, 5),
      myStanding: leaders.find((entry) => entry.userId === context.appUser.id) ?? null,
      teamLeaders: teamLeaders.slice(0, 5),
      myTeamStanding: teamLeaders.find((entry) => entry.teamId === currentUserTeamId) ?? null
    });
  }

  const activeCompetitions = competitionItems.filter((item) => item.status === "active");
  const upcomingCompetitions = competitionItems.filter((item) => item.status === "scheduled");
  const completedCompetitions = competitionItems.filter((item) => item.status === "completed");
  const badges = deriveBadges({
    dailyLeaderboard,
    weeklyLeaderboard,
    currentUserId: context.appUser.id
  });
  const myDaily = dailyLeaderboard.find((entry) => entry.userId === context.appUser.id) ?? null;
  const myWeekly = weeklyLeaderboard.find((entry) => entry.userId === context.appUser.id) ?? null;

  return {
    canManageCompetitions: hasManagerAccess(context),
    dailyLeaderboard,
    weeklyLeaderboard,
    teamDailyLeaderboard,
    teamWeeklyLeaderboard,
    activeCompetitions,
    upcomingCompetitions,
    completedCompetitions,
    badges,
    mySummary: {
      dailyRank: myDaily?.rank ?? null,
      weeklyRank: myWeekly?.rank ?? null,
      dailyKnocks: myDaily?.knocks ?? 0,
      weeklyAppointments: myWeekly?.appointments ?? 0,
      activeCompetitionCount: activeCompetitions.length
    }
  };
}

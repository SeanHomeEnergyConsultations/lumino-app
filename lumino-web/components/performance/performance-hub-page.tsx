"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Crown,
  Medal,
  PlusCircle,
  Sparkles,
  Swords,
  Trophy,
  Zap
} from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import type {
  PerformanceBadgeItem,
  PerformanceCompetitionItem,
  PerformanceCompetitionMetric,
  PerformanceCompetitionScope,
  PerformanceHubResponse,
  PerformanceLeaderboardEntry,
  PerformanceTeamLeaderboardEntry
} from "@/types/api";

function toDateTimeLocal(value: Date) {
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function defaultEndFor(periodType: "day" | "week" | "custom", startAt: string) {
  const start = new Date(startAt);
  const next = new Date(start);
  if (periodType === "week") {
    next.setDate(next.getDate() + 7);
  } else if (periodType === "day") {
    next.setDate(next.getDate() + 1);
  } else {
    next.setDate(next.getDate() + 3);
  }
  return toDateTimeLocal(next);
}

function metricLabel(metric: PerformanceCompetitionMetric) {
  switch (metric) {
    case "appointments":
      return "Appointments";
    case "opportunities":
      return "Opportunities";
    case "doorhangers":
      return "Doorhangers";
    default:
      return "Doors Knocked";
  }
}

function toneClasses(tone: PerformanceBadgeItem["tone"]) {
  switch (tone) {
    case "gold":
      return "border-amber-200 bg-amber-100/80 text-amber-900";
    case "silver":
      return "border-slate-200 bg-slate-100/80 text-slate-900";
    case "emerald":
      return "border-emerald-200 bg-emerald-100/80 text-emerald-900";
    case "electric":
      return "border-cyan-200 bg-cyan-100/80 text-cyan-900";
    default:
      return "border-orange-200 bg-orange-100/80 text-orange-900";
  }
}

function scopeLabel(scope: PerformanceCompetitionScope) {
  return scope === "team" ? "Team Race" : "Individual Race";
}

function PodiumCard({
  entry,
  place
}: {
  entry: PerformanceLeaderboardEntry | null;
  place: 1 | 2 | 3;
}) {
  const heights = { 1: "h-48", 2: "h-40", 3: "h-32" } as const;
  const tones = {
    1: "border-amber-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.32),rgba(255,255,255,0)_30%),rgba(254,243,199,0.94)]",
    2: "border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.32),rgba(255,255,255,0)_30%),rgba(226,232,240,0.9)]",
    3: "border-orange-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.32),rgba(255,255,255,0)_30%),rgba(254,215,170,0.9)]"
  } as const;

  return (
    <div className="flex flex-1 flex-col justify-end">
      <div className="mb-3 text-center">
        <div className="text-sm font-semibold text-ink">{entry?.fullName ?? "Open Spot"}</div>
        <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.6)]">
          {entry ? `${entry.metricValue} points` : "No activity yet"}
        </div>
      </div>
      <div className={`rounded-[1.8rem] border p-4 text-center shadow-panel ${tones[place]} ${heights[place]}`}>
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-ink">
          {place === 1 ? <Crown className="h-5 w-5" /> : <Medal className="h-5 w-5" />}
        </div>
        <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[rgba(var(--app-primary-rgb),0.68)]">
          #{place}
        </div>
      </div>
    </div>
  );
}

function CompetitionCard({ item }: { item: PerformanceCompetitionItem }) {
  const rows = item.scope === "team" ? item.teamLeaders : item.leaders;

  return (
    <div className="app-panel-soft rounded-[1.8rem] border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">
            {scopeLabel(item.scope)} • {metricLabel(item.metric)}
          </div>
          <div className="mt-2 text-xl font-semibold text-ink">{item.title}</div>
          {item.description ? (
            <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">{item.description}</div>
          ) : null}
        </div>
        <div className="app-chip rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.74)]">
          {item.status}
        </div>
      </div>

      <div className="mt-4 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
        {new Date(item.startAt).toLocaleString()} - {new Date(item.endAt).toLocaleString()}
      </div>

      <div className="mt-4 space-y-2">
        {rows.length ? (
          rows.map((entry) => (
            <div
              key={item.scope === "team" ? (entry as PerformanceTeamLeaderboardEntry).teamId : (entry as PerformanceLeaderboardEntry).userId}
              className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-sm ${
                (item.scope === "team"
                  ? (entry as PerformanceTeamLeaderboardEntry).isCurrentUsersTeam
                  : (entry as PerformanceLeaderboardEntry).isCurrentUser)
                  ? "border-[rgba(var(--app-accent-rgb),0.28)] bg-[rgba(var(--app-accent-rgb),0.14)]"
                  : "border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.48)]"
              }`}
            >
              <div className="font-semibold text-ink">
                #{entry.rank}{" "}
                {item.scope === "team"
                  ? (entry as PerformanceTeamLeaderboardEntry).name
                  : (entry as PerformanceLeaderboardEntry).fullName ?? (entry as PerformanceLeaderboardEntry).email ?? "Rep"}
              </div>
              <div className="text-[rgba(var(--app-primary-rgb),0.72)]">{entry.metricValue}</div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed p-3 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
            No activity logged yet.
          </div>
        )}
      </div>

      {item.scope === "team" ? item.myTeamStanding ? (
        <div className="mt-4 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/70 px-3 py-3 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          Your team is currently #{item.myTeamStanding.rank} with {item.myTeamStanding.metricValue}{" "}
          {metricLabel(item.metric).toLowerCase()}.
        </div>
      ) : null : item.myStanding ? (
        <div className="mt-4 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/70 px-3 py-3 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          You’re currently #{item.myStanding.rank} with {item.myStanding.metricValue} {metricLabel(item.metric).toLowerCase()}.
        </div>
      ) : null}
    </div>
  );
}

function TeamLeaderboardRow({ entry }: { entry: PerformanceTeamLeaderboardEntry }) {
  return (
    <div
      className={`flex items-center justify-between rounded-3xl border px-4 py-3 text-sm ${
        entry.isCurrentUsersTeam
          ? "border-[rgba(var(--app-accent-rgb),0.28)] bg-[rgba(var(--app-accent-rgb),0.16)]"
          : "app-panel-soft"
      }`}
    >
      <div>
        <div className="font-semibold text-ink">
          #{entry.rank} {entry.name}
        </div>
        <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
          {entry.managerName ? `Manager: ${entry.managerName}` : "No manager assigned yet"}
        </div>
      </div>
      <div className="text-lg font-semibold text-ink">{entry.metricValue}</div>
    </div>
  );
}

export function PerformanceHubPage() {
  const { session, appContext } = useAuth();
  const [hub, setHub] = useState<PerformanceHubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [createState, setCreateState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [metric, setMetric] = useState<PerformanceCompetitionMetric>("knocks");
  const [scope, setScope] = useState<PerformanceCompetitionScope>("individual");
  const [periodType, setPeriodType] = useState<"day" | "week" | "custom">("day");
  const [startAt, setStartAt] = useState(() => toDateTimeLocal(new Date()));
  const [endAt, setEndAt] = useState(() => defaultEndFor("day", toDateTimeLocal(new Date())));

  const loadHub = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await authFetch(session.access_token, "/api/performance");
      if (!response.ok) {
        setError("Could not load the performance hub.");
        return;
      }
      const json = (await response.json()) as PerformanceHubResponse;
      setHub(json);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void loadHub();
  }, [loadHub]);

  const podium = useMemo(() => {
    const items = hub?.dailyLeaderboard ?? [];
    return {
      first: items[0] ?? null,
      second: items[1] ?? null,
      third: items[2] ?? null
    };
  }, [hub?.dailyLeaderboard]);

  return (
    <div className="p-4 md:p-6">
      <div className="app-panel rounded-[2rem] border p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Performance Hub</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Wins, races, and rep momentum</h1>
        <p className="mt-3 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          Keep the floor competitive, visible, and fun. Reps can see where they stand. Managers can spin up contests that actually match the team’s goals.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            {
              label: "Today’s Rank",
              value: hub?.mySummary.dailyRank ? `#${hub.mySummary.dailyRank}` : "—",
              detail: `${hub?.mySummary.dailyKnocks ?? 0} doors knocked`,
              icon: Trophy
            },
            {
              label: "Weekly Appts",
              value: hub?.mySummary.weeklyAppointments ?? 0,
              detail: hub?.mySummary.weeklyRank ? `#${hub.mySummary.weeklyRank} this week` : "No weekly rank yet",
              icon: CalendarRange
            },
            {
              label: "Active Competitions",
              value: hub?.mySummary.activeCompetitionCount ?? 0,
              detail: "Live races the team can see right now",
              icon: Swords
            },
            {
              label: "Awards Unlocked",
              value: hub?.badges.length ?? 0,
              detail: "Momentum badges based on live production",
              icon: Sparkles
            }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="app-panel-soft rounded-[1.8rem] border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
                  <Icon className="h-4 w-4 text-[rgba(var(--app-primary-rgb),0.58)]" />
                </div>
                <div className="mt-3 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
                <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <section className="app-panel rounded-[2rem] border p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Daily Door Leaderboard</div>
              <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
                Who is pushing the neighborhood hardest today.
              </p>
            </div>
            <div className="app-chip rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.74)]">
              Live
            </div>
          </div>

          <div className="mt-6 flex items-end gap-4">
            <PodiumCard entry={podium.second} place={2} />
            <PodiumCard entry={podium.first} place={1} />
            <PodiumCard entry={podium.third} place={3} />
          </div>

          <div className="mt-6 space-y-3">
            {(hub?.dailyLeaderboard.slice(3) ?? []).map((entry) => (
              <div
                key={entry.userId}
                className={`flex items-center justify-between rounded-3xl border px-4 py-3 text-sm ${
                  entry.isCurrentUser
                    ? "border-[rgba(var(--app-accent-rgb),0.28)] bg-[rgba(var(--app-accent-rgb),0.16)]"
                    : "app-panel-soft"
                }`}
              >
                <div>
                  <div className="font-semibold text-ink">
                    #{entry.rank} {entry.fullName ?? entry.email ?? "Rep"}
                  </div>
                  <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
                    {entry.opportunities} opps • {entry.appointments} appts
                  </div>
                </div>
                <div className="text-lg font-semibold text-ink">{entry.metricValue}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="app-panel rounded-[2rem] border p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Awards</div>
          <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
            Fast visual wins that keep the floor competitive.
          </p>

          <div className="mt-5 space-y-3">
            {(hub?.badges ?? []).map((badge) => (
              <div key={badge.id} className={`rounded-[1.6rem] border px-4 py-4 ${toneClasses(badge.tone)}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Zap className="h-4 w-4" />
                  {badge.label}
                </div>
                <div className="mt-2 text-sm">{badge.detail}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="app-panel rounded-[2rem] border p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Daily Team Race</div>
          <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
            See which manager-led team is stacking the most doors today.
          </p>

          <div className="mt-5 space-y-3">
            {(hub?.teamDailyLeaderboard ?? []).length ? (
              hub?.teamDailyLeaderboard.map((entry) => <TeamLeaderboardRow key={entry.teamId} entry={entry} />)
            ) : (
              <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                Create teams in Team Management to unlock the team raceboard.
              </div>
            )}
          </div>
        </section>

        <section className="app-panel rounded-[2rem] border p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Weekly Appointment Race</div>
          <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
            The cleanest signal for who is turning energy into real booked meetings.
          </p>

          <div className="mt-5 space-y-3">
            {(hub?.weeklyLeaderboard ?? []).map((entry) => (
              <div
                key={entry.userId}
                className={`flex items-center justify-between rounded-3xl border px-4 py-3 text-sm ${
                  entry.isCurrentUser
                    ? "border-[rgba(var(--app-accent-rgb),0.28)] bg-[rgba(var(--app-accent-rgb),0.16)]"
                    : "app-panel-soft"
                }`}
              >
                <div>
                  <div className="font-semibold text-ink">
                    #{entry.rank} {entry.fullName ?? entry.email ?? "Rep"}
                  </div>
                  <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
                    {entry.knocks} knocks • {entry.opportunities} opps this week
                  </div>
                </div>
                <div className="text-lg font-semibold text-ink">{entry.metricValue}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="app-panel rounded-[2rem] border p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Weekly Team Appointment Race</div>
          <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
            Track which team is converting effort into booked meetings this week.
          </p>

          <div className="mt-5 space-y-3">
            {(hub?.teamWeeklyLeaderboard ?? []).length ? (
              hub?.teamWeeklyLeaderboard.map((entry) => <TeamLeaderboardRow key={entry.teamId} entry={entry} />)
            ) : (
              <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                Team standings will show up as soon as reps are assigned under managers.
              </div>
            )}
          </div>
        </section>

        <section className="app-panel rounded-[2rem] border p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Active Competitions</div>
          <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
            Manager-created races everyone can see live.
          </p>

          <div className="mt-5 space-y-4">
            {(hub?.activeCompetitions ?? []).length ? (
              hub?.activeCompetitions.map((item) => <CompetitionCard key={item.id} item={item} />)
            ) : (
              <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                No active competitions right now.
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="app-panel rounded-[2rem] border p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Upcoming Competitions</div>
          <div className="mt-5 space-y-3">
            {(hub?.upcomingCompetitions ?? []).length ? (
              hub?.upcomingCompetitions.map((item) => <CompetitionCard key={item.id} item={item} />)
            ) : (
              <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                Nothing scheduled yet.
              </div>
            )}
          </div>
        </section>

        <section className="app-panel rounded-[2rem] border p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Recent Winners</div>
          <div className="mt-5 space-y-3">
            {(hub?.completedCompetitions ?? []).length ? (
              hub?.completedCompetitions.slice(0, 4).map((item) => <CompetitionCard key={item.id} item={item} />)
            ) : (
              <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                Run a competition and the winners will land here.
              </div>
            )}
          </div>
        </section>
      </div>

      {hub?.canManageCompetitions ? (
        <section className="app-panel mt-6 rounded-[2rem] border p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Manager Controls</div>
              <h2 className="mt-2 text-2xl font-semibold text-ink">Launch a new competition</h2>
              <p className="mt-2 max-w-2xl text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
                Create a race around doors knocked, opportunities, appointments, or doorhangers. Reps see it live as soon as you save it.
              </p>
            </div>
            <div className="app-glass-button rounded-2xl p-3 text-[rgba(var(--app-primary-rgb),0.72)]">
              <PlusCircle className="h-5 w-5" />
            </div>
          </div>

          <form
            className="mt-5 grid gap-4 md:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!session?.access_token) return;
              setCreateState("saving");
              try {
                const response = await authFetch(session.access_token, "/api/performance", {
                  method: "POST",
                  body: JSON.stringify({
                    title,
                    description: description || null,
                    metric,
                    scope,
                    periodType,
                    startAt: new Date(startAt).toISOString(),
                    endAt: new Date(endAt).toISOString()
                  })
                });
                if (!response.ok) {
                  throw new Error("Could not create competition.");
                }
                setCreateState("saved");
                setTitle("");
                setDescription("");
                const freshStart = toDateTimeLocal(new Date());
                setStartAt(freshStart);
                setEndAt(defaultEndFor(periodType, freshStart));
                await loadHub();
              } catch {
                setCreateState("error");
              }
            }}
          >
            <label className="text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
              Competition title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                placeholder="Most doors today"
              />
            </label>
            <label className="text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
              Metric
              <select
                value={metric}
                onChange={(event) => setMetric(event.target.value as PerformanceCompetitionMetric)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              >
                <option value="knocks">Doors knocked</option>
                <option value="opportunities">Opportunities</option>
                <option value="appointments">Appointments</option>
                <option value="doorhangers">Doorhangers</option>
              </select>
            </label>
            <label className="text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
              Scope
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as PerformanceCompetitionScope)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              >
                <option value="individual">Rep vs Rep</option>
                <option value="team">Team vs Team</option>
              </select>
            </label>
            <label className="text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
              Period
              <select
                value={periodType}
                onChange={(event) => {
                  const next = event.target.value as "day" | "week" | "custom";
                  setPeriodType(next);
                  setEndAt(defaultEndFor(next, startAt));
                }}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
              Start
              <input
                type="datetime-local"
                value={startAt}
                onChange={(event) => {
                  setStartAt(event.target.value);
                  if (periodType !== "custom") {
                    setEndAt(defaultEndFor(periodType, event.target.value));
                  }
                }}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
            <label className="text-sm text-[rgba(var(--app-primary-rgb),0.68)] md:col-span-2">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                placeholder="First rep to 3 appointments this week wins bragging rights."
              />
            </label>
            <label className="text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
              End
              <input
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>

            <div className="md:col-span-2 flex items-center justify-between gap-3">
              <div className="text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
                {createState === "saved"
                  ? "Competition created and visible to the team."
                  : createState === "error"
                    ? "Could not create competition."
                    : "Reps will see this immediately in their shared Performance Hub."}
              </div>
              <button
                type="submit"
                disabled={createState === "saving" || !title.trim()}
                className="app-primary-button rounded-2xl px-5 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:opacity-50"
              >
                {createState === "saving" ? "Creating..." : "Create Competition"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

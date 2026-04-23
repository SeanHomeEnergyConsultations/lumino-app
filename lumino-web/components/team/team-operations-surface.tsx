"use client";

import { useTeamWorkspace } from "@/components/team/team-workspace-context";

const teamFieldClassName = "app-focus-ring rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink";
const teamFieldWideClassName = `w-full ${teamFieldClassName}`;

export function TeamOperationsSurface() {
  const {
    canEditBranding,
    dashboard,
    teams,
    teamManagerOptions,
    createTeamName,
    setCreateTeamName,
    createTeamManagerId,
    setCreateTeamManagerId,
    handleCreateTeam,
    hasAccessToken,
    teamState,
    teamDrafts,
    setTeamDrafts,
    handleUpdateTeam,
    inviteName,
    setInviteName,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    handleInviteMember,
    inviteState,
    members,
    currentAppUserId,
    handleUpdateMember,
    handleMemberAction,
    canDeleteMembers,
    handleDeleteMember,
    issues,
    handleCleanupIssue
  } = useTeamWorkspace();

  return (
    <>
      {canEditBranding ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
          <section className="app-panel rounded-[2rem] border p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Rep Roster</div>
                <p className="mt-2 text-sm text-slate-500">Who is active today and how their field output is trending.</p>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
                {dashboard?.repScorecards.length ?? 0}
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
              {(dashboard?.repScorecards ?? []).slice(0, 6).map((rep) => (
                <div
                  key={rep.userId}
                  className="grid gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.7fr))] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{rep.fullName ?? rep.email ?? "Unknown rep"}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">{rep.role}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Knocks</div>
                    <div className="mt-1 text-sm text-slate-700">{rep.knocks}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Opps</div>
                    <div className="mt-1 text-sm text-slate-700">{rep.opportunities}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Appts</div>
                    <div className="mt-1 text-sm text-slate-700">{rep.appointments}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Overdue</div>
                    <div className="mt-1 text-sm text-slate-700">{rep.overdueFollowUps}</div>
                  </div>
                </div>
              ))}
              {!dashboard?.repScorecards.length ? (
                <div className="p-4 text-sm text-slate-500">No rep activity yet for this organization.</div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Coaching Snapshot</div>
                <p className="mt-2 text-sm text-slate-500">Flags worth discussing with the team before they become process leaks.</p>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
                {dashboard?.coachingFlags.length ?? 0}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(dashboard?.coachingFlags ?? []).slice(0, 4).map((flag) => (
                <div key={flag.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">{flag.repName ?? "Rep"}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{flag.reason}</div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {flag.severity}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">{flag.detail}</div>
                </div>
              ))}
              {!dashboard?.coachingFlags.length ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No coaching flags right now.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Teams</div>
              <p className="mt-2 text-sm text-slate-500">
                Group reps under specific managers so leaderboards, competitions, and list scoping can run team by team.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {teams.length}
            </div>
          </div>

          <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-ink">Create team</div>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                type="text"
                value={createTeamName}
                onChange={(event) => setCreateTeamName(event.target.value)}
                placeholder="North Team"
                className={teamFieldClassName}
              />
              <select
                value={createTeamManagerId}
                onChange={(event) => setCreateTeamManagerId(event.target.value)}
                className={teamFieldClassName}
              >
                <option value="">No manager yet</option>
                {teamManagerOptions.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.fullName ?? member.email ?? "Manager"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleCreateTeam()}
                disabled={!hasAccessToken || teamState === "saving" || !createTeamName.trim()}
                className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {teamState === "saving" ? "Saving..." : "Create Team"}
              </button>
            </div>
            <div className="mt-3 text-sm text-slate-500">
              {teamState === "saved"
                ? "Team saved."
                : teamState === "error"
                  ? "A team action failed. Check the notification and try again."
                  : "Assign a manager now, then drop reps and setters into the team from the roster below."}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {teams.length ? (
              teams.map((team) => (
                <div key={team.teamId} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <input
                      type="text"
                      value={teamDrafts[team.teamId]?.name ?? team.name}
                      onChange={(event) =>
                        setTeamDrafts((current) => ({
                          ...current,
                          [team.teamId]: {
                            ...(current[team.teamId] ?? { name: team.name, managerUserId: team.managerUserId ?? "" }),
                            name: event.target.value
                          }
                        }))
                      }
                      className={teamFieldClassName}
                    />
                    <select
                      value={teamDrafts[team.teamId]?.managerUserId ?? team.managerUserId ?? ""}
                      onChange={(event) =>
                        setTeamDrafts((current) => ({
                          ...current,
                          [team.teamId]: {
                            ...(current[team.teamId] ?? { name: team.name, managerUserId: team.managerUserId ?? "" }),
                            managerUserId: event.target.value
                          }
                        }))
                      }
                      className={teamFieldClassName}
                    >
                      <option value="">No manager yet</option>
                      {teamManagerOptions.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.fullName ?? member.email ?? "Manager"}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleUpdateTeam(team.teamId)}
                      disabled={!hasAccessToken || teamState === "saving" || !(teamDrafts[team.teamId]?.name ?? team.name).trim()}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>{team.memberCount} members</span>
                    <span>Manager: {team.managerName ?? "Unassigned"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No teams yet. Create the first one above.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Invite User</div>
            <p className="mt-2 text-sm text-slate-500">Create or reactivate a teammate record and attach it to this organization.</p>
          </div>

          <div className="mt-4 space-y-3">
            <input
              type="text"
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              placeholder="Full name"
              className={teamFieldWideClassName}
            />
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="Email"
              className={teamFieldWideClassName}
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "owner" | "admin" | "manager" | "rep" | "setter")
              }
              className={teamFieldWideClassName}
            >
              {["owner", "admin", "manager", "rep", "setter"].map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleInviteMember()}
              disabled={!inviteEmail.trim() || !inviteName.trim() || inviteState === "saving"}
              className="w-full rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {inviteState === "saving" ? "Saving..." : "Invite User"}
            </button>
            <div className="text-sm text-slate-500">
              {inviteState === "saved"
                ? "Saved."
                : inviteState === "error"
                  ? "A team action failed. Check the notification and try again."
                  : "This creates or reactivates the user record, membership, and access email in one step."}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Team Members</div>
              <p className="mt-2 text-sm text-slate-500">
                Manage roles, access, and which manager-led team each rep or setter belongs to.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {members.length}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {members.length ? (
              members.map((member) => {
                const isSelf = member.userId === currentAppUserId;
                const isProtectedOwner = member.role === "owner";
                const canMutateMember = !isSelf && !isProtectedOwner;
                const canAssignTeam = canMutateMember && ["rep", "setter"].includes(member.role);

                return (
                  <div key={member.memberId} className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)_auto] xl:items-center">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink">{member.fullName ?? member.email ?? "Team member"}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">{member.email ?? "No email"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>Joined {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "unknown"}</span>
                          <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                            {member.onboardingStatus}
                          </span>
                          <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                            {member.role}
                          </span>
                          {member.teamName ? (
                            <span className="inline-flex rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.62)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.72)]">
                              {member.teamName}
                            </span>
                          ) : null}
                          {member.onboardingStatus === "pending" ? (
                            <span>Invited {member.invitedAt ? new Date(member.invitedAt).toLocaleDateString() : "recently"}</span>
                          ) : null}
                          {member.onboardingStatus === "active" && member.lastSignInAt ? (
                            <span>Last signed in {new Date(member.lastSignInAt).toLocaleDateString()}</span>
                          ) : null}
                        </div>
                        {member.teamName ? (
                          <div className="mt-2 text-xs text-slate-500">
                            Reports into {member.teamManagerName ?? "the assigned team manager"}.
                          </div>
                        ) : canAssignTeam ? (
                          <div className="mt-2 text-xs text-slate-500">No team assigned yet.</div>
                        ) : null}
                      </div>

                      <div>
                        {canAssignTeam ? (
                          <>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Assigned team</div>
                            <select
                              value={member.teamId ?? ""}
                              onChange={(event) =>
                                void handleUpdateMember(member.memberId, {
                                  teamId: event.target.value || null
                                })
                              }
                              className={`mt-2 ${teamFieldWideClassName}`}
                            >
                              <option value="">No team yet</option>
                              {teams.map((team) => (
                                <option key={team.teamId} value={team.teamId}>
                                  {team.name}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <div className="text-xs text-slate-500">
                            {isSelf
                              ? "This is your own account."
                              : isProtectedOwner
                                ? "Owners stay protected here."
                                : "Team assignment only applies to reps and setters."}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-start justify-end gap-2">
                        <select
                          value={member.role}
                          disabled={!canMutateMember}
                          onChange={(event) =>
                            void handleUpdateMember(member.memberId, {
                              role: event.target.value as "owner" | "admin" | "manager" | "rep" | "setter"
                            })
                          }
                          className={`${teamFieldClassName} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
                        >
                          {["owner", "admin", "manager", "rep", "setter"].map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!canMutateMember}
                          onClick={() => void handleUpdateMember(member.memberId, { isActive: !member.isActive })}
                          className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                            member.isActive
                              ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                              : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          } disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400`}
                        >
                          {member.isActive ? "Deactivate Access" : "Restore Access"}
                        </button>
                        {member.onboardingStatus !== "active" ? (
                          <button
                            type="button"
                            onClick={() => void handleMemberAction(member.memberId, "resend_invite")}
                            className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
                          >
                            Resend Invite
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleMemberAction(member.memberId, "send_password_reset")}
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                        >
                          Send Password Reset
                        </button>
                        {canDeleteMembers && canMutateMember && ["rep", "setter"].includes(member.role) ? (
                          <details className="group relative">
                            <summary className="list-none cursor-pointer rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300">
                              Offboard
                            </summary>
                            <div className="absolute right-0 z-10 mt-2 flex min-w-[13rem] flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteMember(
                                    member.memberId,
                                    member.fullName ?? member.email ?? "this team member",
                                    "remove"
                                  )
                                }
                                className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Remove from Org
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteMember(
                                    member.memberId,
                                    member.fullName ?? member.email ?? "this team member",
                                    "account"
                                  )
                                }
                                className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                              >
                                Delete from Lumino
                              </button>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No members found yet.
              </div>
            )}
          </div>
        </section>
      </div>

      {canDeleteMembers ? (
        <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Team Cleanup</div>
              <p className="mt-2 text-sm text-slate-500">
                Find stale auth/app-user mismatches before they break reinvites or password resets.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {issues.length}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {issues.length ? (
              issues.map((issue) => (
                <div key={issue.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{issue.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                        {issue.severity} {issue.email ? `• ${issue.email}` : ""}
                      </div>
                      <div className="mt-2 text-sm text-slate-600">{issue.detail}</div>
                    </div>
                    {issue.cleanupAction ? (
                      <button
                        type="button"
                        onClick={() => void handleCleanupIssue(issue)}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Clean Up
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No stale team records detected right now.
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}

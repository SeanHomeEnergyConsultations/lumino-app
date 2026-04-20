export const FILTER_OPTIONS = [
  { key: "all", label: "All", mobileLabel: "All" },
  { key: "high_priority", label: "High Priority", mobileLabel: "Priority" },
  { key: "not_home", label: "Not Home", mobileLabel: "Not Home" },
  { key: "left_doorhanger", label: "Left Doorhanger", mobileLabel: "Doorhanger" },
  { key: "opportunity", label: "Opportunity", mobileLabel: "Opps" },
  { key: "follow_up_overdue", label: "Follow-Up Overdue", mobileLabel: "Overdue" },
  { key: "not_interested", label: "Not Interested", mobileLabel: "No Interest" },
  { key: "disqualified", label: "Disqualified", mobileLabel: "DQ" },
  { key: "appointment_set", label: "Appointments", mobileLabel: "Appts" },
  { key: "unworked_property", label: "Untouched", mobileLabel: "Fresh" }
] as const;

export type MapFilterKey = (typeof FILTER_OPTIONS)[number]["key"];

export function MapToolbar({
  activeFilters,
  onToggle,
  showTeamKnocks,
  onToggleTeamKnocks,
  canToggleTeamKnocks,
  showPriorityFilter = true
}: {
  activeFilters: MapFilterKey[];
  onToggle: (filter: MapFilterKey) => void;
  showTeamKnocks: boolean;
  onToggleTeamKnocks: () => void;
  canToggleTeamKnocks: boolean;
  showPriorityFilter?: boolean;
}) {
  return (
    <div className="overflow-x-auto border-b border-slate-200/80 bg-white/75 px-4 py-3 backdrop-blur md:px-6">
      <div className="flex min-w-max items-center gap-2">
        {canToggleTeamKnocks ? (
          <button
            type="button"
            onClick={onToggleTeamKnocks}
            className={`rounded-full border px-3 py-2 text-sm transition ${
              showTeamKnocks
                ? "border-sky-600 bg-sky-600 text-white shadow-panel"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span className="hidden sm:inline">{showTeamKnocks ? "Showing Team Knocks" : "Show Team Knocks"}</span>
            <span className="sm:hidden">{showTeamKnocks ? "Team On" : "Team"}</span>
          </button>
        ) : null}
        {FILTER_OPTIONS.filter((option) => showPriorityFilter || option.key !== "high_priority").map((option) => {
          const active = activeFilters.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onToggle(option.key)}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                active
                  ? "border-ink bg-ink text-white shadow-panel"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className="hidden sm:inline">{option.label}</span>
              <span className="sm:hidden">{option.mobileLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

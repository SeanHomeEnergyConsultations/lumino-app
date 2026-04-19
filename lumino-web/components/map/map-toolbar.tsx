export const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "high_priority", label: "High Priority" },
  { key: "not_home", label: "Not Home" },
  { key: "left_doorhanger", label: "Left Doorhanger" },
  { key: "opportunity", label: "Opportunity" },
  { key: "follow_up_overdue", label: "Follow-Up Overdue" },
  { key: "not_interested", label: "Not Interested" },
  { key: "disqualified", label: "Disqualified" },
  { key: "appointment_set", label: "Appointments" },
  { key: "unworked_property", label: "Untouched" }
] as const;

export type MapFilterKey = (typeof FILTER_OPTIONS)[number]["key"];

export function MapToolbar({
  activeFilters,
  onToggle,
  showTeamKnocks,
  onToggleTeamKnocks,
  canToggleTeamKnocks
}: {
  activeFilters: MapFilterKey[];
  onToggle: (filter: MapFilterKey) => void;
  showTeamKnocks: boolean;
  onToggleTeamKnocks: () => void;
  canToggleTeamKnocks: boolean;
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
            {showTeamKnocks ? "Showing Team Knocks" : "Show Team Knocks"}
          </button>
        ) : null}
        {FILTER_OPTIONS.map((option) => {
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
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

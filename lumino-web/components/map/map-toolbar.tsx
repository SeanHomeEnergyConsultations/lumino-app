const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "interested", label: "Interested" },
  { key: "callback_requested", label: "Callbacks" },
  { key: "do_not_knock", label: "Do Not Knock" },
  { key: "appointment_set", label: "Appointments" },
  { key: "unworked_property", label: "Untouched" },
  { key: "canvassed", label: "Canvassed" },
  { key: "imported_target", label: "Imported Targets" },
  { key: "follow_up_overdue", label: "Follow-Up Overdue" }
] as const;

export type MapFilterKey = (typeof FILTER_OPTIONS)[number]["key"];

export function MapToolbar({
  activeFilters,
  onToggle
}: {
  activeFilters: MapFilterKey[];
  onToggle: (filter: MapFilterKey) => void;
}) {
  return (
    <div className="overflow-x-auto border-b border-slate-200/80 bg-white/75 px-4 py-3 backdrop-blur md:px-6">
      <div className="flex min-w-max items-center gap-2">
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

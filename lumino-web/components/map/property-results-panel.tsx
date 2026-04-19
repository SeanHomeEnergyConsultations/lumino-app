import {
  BadgeHelp,
  Ban,
  CalendarCheck2,
  CircleDashed,
  Clock3,
  DoorOpen,
  FileBadge2,
  Handshake,
  HelpCircle,
  House,
  PhoneCall,
  UserRoundCheck,
  XCircle
} from "lucide-react";
import type { MapProperty } from "@/types/entities";

export function mapStateVisual(mapState: MapProperty["mapState"]) {
  switch (mapState) {
    case "not_home":
      return { icon: DoorOpen, className: "bg-slate-100 text-slate-700" };
    case "left_doorhanger":
      return { icon: FileBadge2, className: "bg-violet-100 text-violet-700" };
    case "opportunity":
      return { icon: Handshake, className: "bg-field/15 text-field" };
    case "interested":
      return { icon: Handshake, className: "bg-field/15 text-field" };
    case "callback_requested":
      return { icon: PhoneCall, className: "bg-alert/15 text-alert" };
    case "not_interested":
      return { icon: XCircle, className: "bg-orange-100 text-orange-600" };
    case "disqualified":
      return { icon: BadgeHelp, className: "bg-zinc-200 text-zinc-700" };
    case "do_not_knock":
      return { icon: Ban, className: "bg-rose-100 text-rose-600" };
    case "follow_up_overdue":
      return { icon: Clock3, className: "bg-rose-100 text-rose-600" };
    case "appointment_set":
      return { icon: CalendarCheck2, className: "bg-sky-100 text-sky-700" };
    case "customer":
      return { icon: UserRoundCheck, className: "bg-emerald-100 text-emerald-700" };
    case "canvassed_with_lead":
      return { icon: House, className: "bg-slate-200 text-slate-800" };
    case "canvassed":
      return { icon: CircleDashed, className: "bg-slate-100 text-slate-600" };
    case "imported_target":
      return { icon: HelpCircle, className: "bg-amber-100 text-amber-700" };
    default:
      return { icon: House, className: "bg-slate-100 text-slate-600" };
  }
}

export function PropertyResultsPanel({
  items,
  selectedPropertyId,
  onSelect,
  className = "relative z-20 hidden w-80 shrink-0 border-r border-slate-200/80 bg-white/80 backdrop-blur xl:block",
  showHeader = true
}: {
  items: MapProperty[];
  selectedPropertyId: string | null;
  onSelect: (propertyId: string) => void;
  className?: string;
  showHeader?: boolean;
}) {
  return (
    <aside className={className}>
      {showHeader ? (
        <div className="border-b border-slate-200/80 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Nearby Targets</div>
          <div className="mt-1 text-sm text-slate-600">{items.length} properties in view</div>
        </div>
      ) : null}
      <div className="max-h-[calc(100vh-8rem)] space-y-2 overflow-y-auto p-3">
        {items.map((item) => {
          const visual = mapStateVisual(item.mapState);
          const Icon = visual.icon;

          return (
            <button
              key={item.propertyId}
              type="button"
              onClick={() => onSelect(item.propertyId)}
              className={`w-full rounded-2xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-ink/30 ${
                selectedPropertyId === item.propertyId
                  ? "border-ink bg-ink text-white shadow-panel"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    selectedPropertyId === item.propertyId ? "bg-white/15 text-white" : visual.className
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{item.address}</div>
                  <div className={`mt-1 text-xs ${selectedPropertyId === item.propertyId ? "text-slate-200" : "text-slate-500"}`}>
                    {item.visitCount} visits
                    {item.mapState === "not_home" && item.notHomeCount > 1 ? ` · ${item.notHomeCount} tries` : ""}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

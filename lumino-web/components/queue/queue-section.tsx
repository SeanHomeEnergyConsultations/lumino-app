import type { RepQueueItem } from "@/types/api";
import { QueueCard } from "@/components/queue/queue-card";

export function QueueSection({
  title,
  description,
  items,
  accessToken,
  onUpdated,
  selectable = false,
  selectedLeadIds = new Set<string>(),
  onToggleSelected
}: {
  title: string;
  description: string;
  items: RepQueueItem[];
  accessToken: string | null;
  onUpdated: () => Promise<unknown>;
  selectable?: boolean;
  selectedLeadIds?: Set<string>;
  onToggleSelected?: (leadId: string) => void;
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white/70 p-5 shadow-panel backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{title}</div>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
          {items.length}
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {items.length ? (
          items.map((item) => (
            <QueueCard
              key={`${title}-${item.leadId}`}
              item={item}
              accessToken={accessToken}
              onUpdated={onUpdated}
              selectable={selectable}
              selected={selectedLeadIds.has(item.leadId)}
              onToggleSelected={onToggleSelected}
            />
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            Nothing in this queue right now.
          </div>
        )}
      </div>
    </section>
  );
}

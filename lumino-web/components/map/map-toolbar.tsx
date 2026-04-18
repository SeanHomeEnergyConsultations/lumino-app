export function MapToolbar() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200/80 bg-white/60 px-4 py-3 backdrop-blur md:px-6">
      <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
        Nearby homes
      </div>
      <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
        Follow-up overdue
      </div>
      <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
        Imported targets
      </div>
    </div>
  );
}

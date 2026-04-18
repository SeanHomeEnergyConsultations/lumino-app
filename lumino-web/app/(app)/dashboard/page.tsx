import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";

export default function DashboardPage() {
  return (
    <ProtectedAppShell>
      <div className="p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-panel">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Manager Dashboard</div>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Sprint 1 placeholder</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-600">
            This page will hold team activity, rep scorecards, follow-up leakage, and neighborhood performance after the map workflow is stable.
          </p>
        </div>
      </div>
    </ProtectedAppShell>
  );
}

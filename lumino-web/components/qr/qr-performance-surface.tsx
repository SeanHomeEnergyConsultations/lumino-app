"use client";

import { QrCodeCard } from "@/components/qr/qr-code-card";
import { useQrWorkspace } from "@/components/qr/qr-workspace-context";

export function QrPerformanceSurface() {
  const {
    archivingQrCodeId,
    expandedEngagementCodeId,
    items,
    loading,
    setExpandedEngagementCodeId,
    totalStats,
    archiveCode
  } = useQrWorkspace();

  return (
    <div className="space-y-6">
      <section className="app-panel rounded-[2rem] border p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Performance</div>
        <div className="mt-1 text-xl font-semibold text-ink">See which QR experiences are creating real response</div>
        <div className="mt-2 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
          Review total engagement, then open individual code cards to inspect deeper scan and conversion behavior.
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { label: "Total Scans", value: totalStats.scans, detail: "Every landing page visit across your live codes" },
            { label: "Booked Appointments", value: totalStats.bookings, detail: "Appointments created straight from QR scans" },
            { label: "Saved Contacts", value: totalStats.saves, detail: "How often homeowners kept the rep card" }
          ].map((item) => (
            <div key={item.label} className="app-panel-soft rounded-[1.8rem] border p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              <div className="mt-3 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
              <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        {items.map((item) => (
          <QrCodeCard
            key={item.qrCodeId}
            item={item}
            archiving={archivingQrCodeId === item.qrCodeId}
            onArchive={() => void archiveCode(item.qrCodeId)}
            engagementExpanded={expandedEngagementCodeId === item.qrCodeId}
            onToggleEngagement={() =>
              setExpandedEngagementCodeId((current) => (current === item.qrCodeId ? null : item.qrCodeId))
            }
          />
        ))}

        {!loading && !items.length ? (
          <div className="app-panel rounded-[2rem] border border-dashed p-8 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
            No QR performance to report yet. Create a code and start sharing it to see engagement here.
          </div>
        ) : null}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import type { Route } from "next";
import { CalendarCheck2, QrCode, Sparkles } from "lucide-react";
import { QrBookingProfileSurface } from "@/components/qr/qr-booking-profile-surface";
import { QrCodesSurface } from "@/components/qr/qr-codes-surface";
import { QrPerformanceSurface } from "@/components/qr/qr-performance-surface";
import { QrWorkspaceProvider, useQrWorkspace, type QrWorkspaceSurface } from "@/components/qr/qr-workspace-context";

const QR_SURFACE_ROUTES: Record<QrWorkspaceSurface, Route> = {
  codes: "/qr",
  bookingProfile: "/qr/booking-profile",
  performance: "/qr/performance"
};

function QrWorkspaceContent({ surface }: { surface: QrWorkspaceSurface }) {
  const { activeCodeCount, items, totalStats } = useQrWorkspace();

  const surfaces = [
    {
      id: "codes" as const,
      label: "Codes",
      detail: `${activeCodeCount} active experiences`,
      icon: QrCode
    },
    {
      id: "bookingProfile" as const,
      label: "Booking Profile",
      detail: "Reusable availability and appointment types",
      icon: CalendarCheck2
    },
    {
      id: "performance" as const,
      label: "Performance",
      detail: `${totalStats.scans} total scans`,
      icon: Sparkles
    }
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="app-panel rounded-[2rem] border p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">QR Workspace</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Tracked cards that turn scans into leads</h1>
        <p className="mt-3 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          Create rep-owned digital business cards, manage reusable booking setup, and see which QR experiences are actually converting.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { label: "Live Codes", value: activeCodeCount, detail: `${items.length} total cards and trackers` },
            { label: "Total Scans", value: totalStats.scans, detail: "Every landing page visit across your live codes" },
            { label: "Booked Appointments", value: totalStats.bookings, detail: "Appointments created straight from QR scans" }
          ].map((item) => (
            <div key={item.label} className="app-panel-soft rounded-[1.8rem] border p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              <div className="mt-3 text-3xl font-semibold text-ink">{item.value}</div>
              <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <section className="app-panel rounded-[2rem] border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Workspace Surfaces</div>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Split QR work into focused surfaces so setup, publishing, and performance review each have a clear home.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {surfaces.map((item) => {
              const active = surface === item.id;
              const Icon = item.icon;

              return (
                <Link
                  key={item.id}
                  href={QR_SURFACE_ROUTES[item.id]}
                  className={`rounded-[1.4rem] border px-4 py-3 text-left transition ${
                    active
                      ? "bg-[rgba(var(--app-primary-rgb),0.92)] text-white shadow-panel"
                      : "bg-white/75 text-slate-700 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </div>
                  <div className={`mt-1 text-xs ${active ? "text-white/75" : "text-slate-500"}`}>{item.detail}</div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {surface === "codes" ? <QrCodesSurface /> : null}
      {surface === "bookingProfile" ? <QrBookingProfileSurface /> : null}
      {surface === "performance" ? <QrPerformanceSurface /> : null}
    </div>
  );
}

export function QrWorkspacePage({ surface }: { surface: QrWorkspaceSurface }) {
  return (
    <QrWorkspaceProvider>
      <QrWorkspaceContent surface={surface} />
    </QrWorkspaceProvider>
  );
}

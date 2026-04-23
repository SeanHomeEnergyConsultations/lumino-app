"use client";

import type { Route } from "next";
import { CalendarCheck2, QrCode, Sparkles } from "lucide-react";
import { QrBookingProfileSurface } from "@/components/qr/qr-booking-profile-surface";
import { QrCodesSurface } from "@/components/qr/qr-codes-surface";
import { QrPerformanceSurface } from "@/components/qr/qr-performance-surface";
import { WorkspaceHero, WorkspaceMetricGrid, WorkspaceSwitcher } from "@/components/shared/workspace-primitives";
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
      <WorkspaceHero
        eyebrow="QR Workspace"
        title="Tracked cards that turn scans into leads"
        description="Create rep-owned digital business cards, manage reusable booking setup, and see which QR experiences are actually converting."
      />

      <WorkspaceMetricGrid
        items={[
          { label: "Live Codes", value: activeCodeCount, detail: `${items.length} total cards and trackers`, tone: "soft" },
          { label: "Total Scans", value: totalStats.scans, detail: "Every landing page visit across your live codes", tone: "soft" },
          { label: "Booked Appointments", value: totalStats.bookings, detail: "Appointments created straight from QR scans", tone: "soft" }
        ]}
      />

      <WorkspaceSwitcher
        title="Workspace Surfaces"
        description="Split QR work into focused surfaces so setup, publishing, and performance review each have a clear home."
        activeSurface={surface}
        items={surfaces.map((item) => ({
          ...item,
          href: QR_SURFACE_ROUTES[item.id]
        }))}
      />

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
